#!/usr/bin/env node

import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { downloadFile, fetchText } from './utils/download.js';
import { createLineReader } from './utils/line-reader.js';
import { createProgressCounter } from './utils/progress.js';

const NDJSON_PATH = 'data/pageviews.ndjson';
const SEED_NDJSON_PATH = 'data/pageviews-seed.ndjson';
const TMP_DIR = 'data/pageviews-tmp';
const ACCUM_DB_PATH = 'data/pageviews-tmp/accumulator.db';
const BATCH_SIZE = 10_000;
const BASE_URL = 'https://dumps.wikimedia.org/other/pageview_complete/monthly';
const DOWNLOAD_CONCURRENCY = 2;
const SOURCE_FILES = [
  'data/humans.ndjson',
  'data/fictional.ndjson',
  'data/apocryphal.ndjson',
];

function filenameFromUrl(url: string): string {
  return url.split('/').pop()!;
}

function cleanupTemporaryDirectory(): void {
  try {
    rmSync(TMP_DIR, { recursive: true });
  } catch {
    // Ignore — directory may already be gone
  }
}

function ensureBzcat(): void {
  try {
    execFileSync('bzcat', ['--help'], { stdio: 'ignore' });
  } catch {
    console.error('Error: bzcat is required but not found. Install bzip2.');
    process.exit(1);
  }
}

function extractWikiTitle(wikipedia: string): string | undefined {
  try {
    const url = new URL(wikipedia);
    return decodeURIComponent(url.pathname.replace('/wiki/', '')).replaceAll(
      ' ',
      '_',
    );
  } catch {
    return undefined;
  }
}

async function loadKnownTitles(): Promise<Set<string>> {
  const titles = new Set<string>();
  for (const file of SOURCE_FILES) {
    if (!existsSync(file)) {
      console.log(`  Skipping ${file} (not found)`);
      continue;
    }
    const rl = createLineReader(createReadStream(file));
    for await (const line of rl) {
      if (!line.trim()) continue;
      const { wikipedia } = JSON.parse(line) as {
        wikipedia?: string | null;
      };
      if (wikipedia) {
        const title = extractWikiTitle(wikipedia);
        if (title) titles.add(title);
      }
    }
  }
  console.log(
    `Loaded ${titles.size.toLocaleString()} known Wikipedia titles from source files.`,
  );
  return titles;
}

function openAccumulator(): DatabaseSync {
  const database = new DatabaseSync(ACCUM_DB_PATH);
  database.exec(`
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    PRAGMA cache_size=-262144;
    PRAGMA temp_store=MEMORY;
    CREATE TABLE IF NOT EXISTS pageviews (
      title TEXT PRIMARY KEY,
      views INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS completed_files (
      filename TEXT PRIMARY KEY
    );
  `);
  return database;
}

function getCompletedFiles(database: DatabaseSync): Set<string> {
  const rows = database
    .prepare('SELECT filename FROM completed_files')
    .all() as Array<{
    filename: string;
  }>;
  return new Set(rows.map((r) => r.filename));
}

function markCompleted(database: DatabaseSync, filename: string): void {
  database
    .prepare('INSERT OR IGNORE INTO completed_files (filename) VALUES (?)')
    .run(filename);
}

function processBz2Stream(
  filePath: string,
  database: DatabaseSync,
  knownTitles: Set<string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bzcat', [filePath], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const rl = createLineReader(child.stdout);

    const upsert = database.prepare(`
      INSERT INTO pageviews (title, views) VALUES (?, ?)
      ON CONFLICT(title) DO UPDATE SET views = views + excluded.views
    `);

    let matched = 0;
    let batch: Array<[string, number]> = [];

    const flush = () => {
      database.exec('BEGIN');
      for (const [title, views] of batch) {
        upsert.run(title, views);
      }
      database.exec('COMMIT');
      batch = [];
    };

    const tick = createProgressCounter(10_000_000, (count) => {
      console.log(
        `  ${(count / 1_000_000).toFixed(0)}M lines, ${matched.toLocaleString()} matched`,
      );
    });

    rl.on('line', (line: string) => {
      tick();

      if (!line.startsWith('en.wikipedia ')) return;

      const fields = line.split(' ');
      if (fields.length < 4) return;

      const title = fields[1];
      if (!knownTitles.has(title)) return;

      const dailyTotal = Number.parseInt(fields.at(-2)!, 10);
      if (Number.isNaN(dailyTotal) || dailyTotal <= 0) return;

      matched++;
      batch.push([title, dailyTotal]);
      if (batch.length >= BATCH_SIZE) flush();
    });

    rl.on('close', () => {
      if (batch.length > 0) flush();
      console.log(`  Done, ${matched.toLocaleString()} matched.`);
      resolve();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`bzcat exited with code ${code}`));
      }
    });
  });
}

async function discoverDumpUrls(): Promise<string[]> {
  console.log('Discovering available monthly dump files...');
  const indexHtml = await fetchText(`${BASE_URL}/`);
  const yearMatches = [...indexHtml.matchAll(/href="(\d{4})\/"/g)];
  const years = yearMatches.map((m) => m[1]).toSorted();

  const urls: string[] = [];

  for (const year of years) {
    const yearHtml = await fetchText(`${BASE_URL}/${year}/`);
    const monthMatches = [...yearHtml.matchAll(/href="(\d{4}-\d{2})\/"/g)];

    for (const monthMatch of monthMatches) {
      const month = monthMatch[1];
      const monthHtml = await fetchText(`${BASE_URL}/${year}/${month}/`);
      const fileMatches = [
        ...monthHtml.matchAll(/href="(pageviews-\d{6}-user\.bz2)"/g),
      ];
      for (const fileMatch of fileMatches) {
        urls.push(`${BASE_URL}/${year}/${month}/${fileMatch[1]}`);
      }
    }
  }

  urls.sort();
  console.log(`Found ${urls.length} monthly dump files.`);
  return urls;
}

function writeNdjson(database: DatabaseSync): void {
  const count = (
    database.prepare('SELECT COUNT(*) AS n FROM pageviews').get() as {
      n: number;
    }
  ).n;
  console.log(`Writing ${count.toLocaleString()} entries to ${NDJSON_PATH}...`);

  mkdirSync('data', { recursive: true });
  const out = createWriteStream(NDJSON_PATH);
  const rows = database
    .prepare('SELECT title, views FROM pageviews')
    .all() as Array<{ title: string; views: number }>;

  for (const row of rows) {
    out.write(JSON.stringify(row) + '\n');
  }

  out.end();
  console.log(`Done. Wrote ${NDJSON_PATH}`);
}

function writeNdjsonFiltered(
  database: DatabaseSync,
  knownTitles: Set<string>,
): void {
  console.log(
    `Filtering accumulator against ${knownTitles.size.toLocaleString()} known titles...`,
  );

  // Load known titles into a temp table so SQLite can use indexed lookups
  // instead of a full 212GB table scan.
  database.exec(
    'CREATE TEMP TABLE IF NOT EXISTS known_titles (title TEXT PRIMARY KEY)',
  );
  const insertKnown = database.prepare(
    'INSERT OR IGNORE INTO known_titles (title) VALUES (?)',
  );

  const titleArray = [...knownTitles];
  for (let i = 0; i < titleArray.length; i += BATCH_SIZE) {
    database.exec('BEGIN');
    for (const title of titleArray.slice(i, i + BATCH_SIZE)) {
      insertKnown.run(title);
    }
    database.exec('COMMIT');
  }

  console.log(`Writing filtered entries to ${NDJSON_PATH}...`);
  mkdirSync('data', { recursive: true });
  const out = createWriteStream(NDJSON_PATH);
  const rows = database
    .prepare(
      'SELECT p.title, p.views FROM pageviews p WHERE p.title IN (SELECT title FROM known_titles)',
    )
    .all() as Array<{ title: string; views: number }>;

  for (const row of rows) {
    out.write(JSON.stringify(row) + '\n');
  }

  out.end();
  console.log(`Done. Wrote ${rows.length.toLocaleString()} entries to ${NDJSON_PATH}`);
}

async function seedFromNdjson(database: DatabaseSync): Promise<void> {
  if (!existsSync(SEED_NDJSON_PATH)) return;

  console.log(`Seeding accumulator from ${SEED_NDJSON_PATH}...`);
  const upsert = database.prepare(`
    INSERT INTO pageviews (title, views) VALUES (?, ?)
    ON CONFLICT(title) DO UPDATE SET views = views + excluded.views
  `);

  const rl = createLineReader(createReadStream(SEED_NDJSON_PATH));
  let count = 0;
  let batch: Array<{ title: string; views: number }> = [];

  const flush = () => {
    database.exec('BEGIN');
    for (const { title, views } of batch) {
      upsert.run(title, views);
    }
    database.exec('COMMIT');
    count += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line) as { title: string; views: number });
    if (batch.length >= BATCH_SIZE) flush();
  }
  if (batch.length > 0) flush();

  console.log(`Seeded ${count.toLocaleString()} entries from existing NDJSON.`);
}

function applySkipUntil(database: DatabaseSync, urls: string[]): void {
  const skipUntilIndex = process.argv.indexOf('--skip-until');
  if (skipUntilIndex === -1 || skipUntilIndex + 1 >= process.argv.length) {
    return;
  }

  const skipUntil = process.argv[skipUntilIndex + 1];
  const cutoff = urls.findIndex((url) => filenameFromUrl(url) === skipUntil);
  if (cutoff === -1) {
    console.error(
      `Warning: --skip-until file "${skipUntil}" not found in dump list.`,
    );
    return;
  }

  for (let index = 0; index <= cutoff; index++) {
    markCompleted(database, filenameFromUrl(urls[index]));
  }
  console.log(
    `Marked ${cutoff + 1} files as already processed (through ${skipUntil}).`,
  );
}

async function processAllFiles(
  remaining: string[],
  database: DatabaseSync,
  knownTitles: Set<string>,
): Promise<void> {
  let nextIndex = 0;
  const downloads: Promise<{ filename: string; destination: string }>[] = [];

  const enqueueDownload = (url: string) => {
    const filename = filenameFromUrl(url);
    const destination = `${TMP_DIR}/${filename}`;
    console.log(`Downloading: ${filename}`);
    const promise = downloadFile(url, destination).then(() => ({
      filename,
      destination,
    }));
    // Prevent unhandled-rejection warnings for promises that are awaited later
    promise.catch(() => {});
    downloads.push(promise);
  };

  // Seed initial downloads
  while (nextIndex < Math.min(DOWNLOAD_CONCURRENCY, remaining.length)) {
    enqueueDownload(remaining[nextIndex]);
    nextIndex++;
  }

  // Process files in order, starting the next download as each completes
  for (let index = 0; index < remaining.length; index++) {
    const { filename, destination } = await downloads[index];

    // Start next download while we process this file
    if (nextIndex < remaining.length) {
      enqueueDownload(remaining[nextIndex]);
      nextIndex++;
    }

    try {
      console.log(`Processing: ${filename}`);
      await processBz2Stream(destination, database, knownTitles);
      markCompleted(database, filename);
    } finally {
      if (existsSync(destination)) {
        rmSync(destination);
        console.log(`Cleaned up: ${filename}`);
      }
    }
  }
}

async function extract(): Promise<void> {
  if (process.argv.includes('--export-only')) {
    console.log('Loading source files to build title filter...');
    const knownTitles = await loadKnownTitles();
    const database = openAccumulator();
    writeNdjsonFiltered(database, knownTitles);
    database.close();
    console.log('\nExport complete.');
    return;
  }

  ensureBzcat();

  console.log('Loading source files to build title filter...');
  const knownTitles = await loadKnownTitles();

  if (knownTitles.size === 0) {
    console.error(
      'No known titles found. Run extract-wikidata.ts first to generate source NDJSON files.',
    );
    process.exit(1);
  }

  const urls = await discoverDumpUrls();
  mkdirSync(TMP_DIR, { recursive: true });

  const database = openAccumulator();
  await seedFromNdjson(database);
  applySkipUntil(database, urls);

  const completed = getCompletedFiles(database);
  const remaining = urls.filter((url) => !completed.has(filenameFromUrl(url)));

  if (completed.size > 0) {
    console.log(
      `Resuming: ${completed.size} files already processed, ${remaining.length} remaining.`,
    );
  }

  if (remaining.length === 0) {
    console.log('All files already processed.');
  } else {
    await processAllFiles(remaining, database, knownTitles);
  }

  writeNdjson(database);
  database.close();
  cleanupTemporaryDirectory();
  console.log('\nExtraction complete.');
}

try {
  await extract();
} catch (error) {
  console.error('Fatal:', error);
  process.exit(1);
}
