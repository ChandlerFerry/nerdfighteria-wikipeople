#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { downloadFile, fetchText } from './utils/download.js';

const NDJSON_PATH = 'data/pageviews.ndjson';
const TMP_DIR = 'data/pageviews-tmp';
const ACCUM_DB_PATH = 'data/pageviews-tmp/accumulator.db';
const BATCH_SIZE = 10_000;
const BASE_URL = 'https://dumps.wikimedia.org/other/pageview_complete/monthly';
const DOWNLOAD_CONCURRENCY = 2;

function ensureBzcat(): void {
  try {
    execFileSync('bzcat', ['--help'], { stdio: 'ignore' });
  } catch {
    console.error('Error: bzcat is required but not found. Install bzip2.');
    process.exit(1);
  }
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
  const rows = database.prepare('SELECT filename FROM completed_files').all() as Array<{
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
  database: DatabaseSync
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bzcat', [filePath], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const rl = createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    const upsert = database.prepare(`
      INSERT INTO pageviews (title, views) VALUES (?, ?)
      ON CONFLICT(title) DO UPDATE SET views = views + excluded.views
    `);

    let lines = 0;
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

    rl.on('line', (line: string) => {
      lines++;
      if (lines % 10_000_000 === 0) {
        console.log(
          `  ${(lines / 1_000_000).toFixed(0)}M lines, ${matched.toLocaleString()} matched`
        );
      }

      if (!line.startsWith('en.wikipedia ')) return;

      const fields = line.split(' ');
      if (fields.length < 4) return;

      const title = fields[1];
      const dailyTotal = Number.parseInt(fields.at(-2)!, 10);
      if (Number.isNaN(dailyTotal) || dailyTotal <= 0) return;

      matched++;
      batch.push([title, dailyTotal]);
      if (batch.length >= BATCH_SIZE) flush();
    });

    rl.on('close', () => {
      if (batch.length > 0) flush();
      console.log(
        `  Processed ${(lines / 1_000_000).toFixed(1)}M lines, ${matched.toLocaleString()} matched.`
      );
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

async function extract(): Promise<void> {
  ensureBzcat();

  const urls = await discoverDumpUrls();
  mkdirSync(TMP_DIR, { recursive: true });

  const database = openAccumulator();

  // Handle --skip-until for bootstrapping resume state from a previous run
  const skipUntilIndex = process.argv.indexOf('--skip-until');
  if (skipUntilIndex !== -1 && skipUntilIndex + 1 < process.argv.length) {
    const skipUntil = process.argv[skipUntilIndex + 1];
    const cutoff = urls.findIndex((url) => url.split('/').pop() === skipUntil);
    if (cutoff === -1) {
      console.error(
        `Warning: --skip-until file "${skipUntil}" not found in dump list.`
      );
    } else {
      for (let index = 0; index <= cutoff; index++) {
        markCompleted(database, urls[index].split('/').pop()!);
      }
      console.log(
        `Marked ${cutoff + 1} files as already processed (through ${skipUntil}).`
      );
    }
  }

  // Filter to remaining files
  const completed = getCompletedFiles(database);
  const remaining = urls.filter(
    (url) => !completed.has(url.split('/').pop()!)
  );

  if (completed.size > 0) {
    console.log(
      `Resuming: ${completed.size} files already processed, ${remaining.length} remaining.`
    );
  }

  if (remaining.length === 0) {
    console.log('All files already processed.');
    writeNdjson(database);
    database.close();
    try {
      rmSync(TMP_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
    console.log('\nExtraction complete.');
    return;
  }

  // Pipeline: keep up to DOWNLOAD_CONCURRENCY downloads ahead of processing
  let nextIndex = 0;
  const downloads: Promise<{ filename: string; destination: string }>[] = [];

  const enqueueDownload = (url: string) => {
    const filename = url.split('/').pop()!;
    const destination = `${TMP_DIR}/${filename}`;
    console.log(`Downloading: ${filename}`);
    const promise = downloadFile(url, destination).then(() => ({
      filename,
      destination,
    }));
    promise.catch(() => {}); // Prevent unhandled rejection while queued
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
      await processBz2Stream(destination, database);
      markCompleted(database, filename);
    } finally {
      if (existsSync(destination)) {
        rmSync(destination);
        console.log(`Cleaned up: ${filename}`);
      }
    }
  }

  writeNdjson(database);
  database.close();

  try {
    rmSync(TMP_DIR, { recursive: true });
  } catch {
    // ignore
  }

  console.log('\nExtraction complete.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await extract();
  } catch (error) {
    console.error('Fatal:', error);
    process.exit(1);
  }
}
