#!/usr/bin/env node

import { createReadStream, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import seedrandom from 'seedrandom';
import { DB_PATH, SCHEMA, type Category } from '../src/database/database.js';
import { createLineReader } from './utils/line-reader.js';
import { createProgressCounter } from './utils/progress.js';

const BATCH_SIZE = 10_000;
const random = seedrandom('nerdfighteria-wikipeople');
const PAGEVIEWS_PATH = 'data/pageviews.ndjson';

const SOURCES: Array<{ file: string; category: Category }> = [
  { file: 'data/humans.ndjson', category: 'humans' },
  { file: 'data/fictional.ndjson', category: 'fictional' },
  { file: 'data/apocryphal.ndjson', category: 'apocryphal' },
];

interface NdjsonRecord {
  qid: string;
  label: string;
  description?: string | null;
  type?: string | null;
  sitelinkCount: number;
  wikipedia?: string | null;
  wikidata?: string | null;
}

function extractTitle(wikipedia: string): string | undefined {
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

function normalizeWikiUrl(wikipedia: string): string {
  const title = extractTitle(wikipedia);
  return title ? `https://en.wikipedia.org/wiki/${title}` : wikipedia;
}

async function buildDatabase(): Promise<void> {
  console.log('Loading pageview data...');
  const pageviews = new Map<string, number>();

  const pvrl = createLineReader(createReadStream(PAGEVIEWS_PATH));
  for await (const line of pvrl) {
    if (!line.trim()) continue;
    const { title, views } = JSON.parse(line) as {
      title: string;
      views: number;
    };
    pageviews.set(title, views);
  }

  console.log(`Loaded ${pageviews.size.toLocaleString()} pageview entries.`);

  const database = new DatabaseSync(DB_PATH);

  database.exec(`
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    PRAGMA cache_size=-131072;
    PRAGMA temp_store=MEMORY;
  `);
  database.exec(SCHEMA);

  const insert = database.prepare(`
    INSERT OR IGNORE INTO entities
      (qid, label, description, type, category, sitelink_count, pageviews, wikipedia, wikidata, rand)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalImported = 0;

  for (const { file, category } of SOURCES) {
    if (!existsSync(file)) {
      console.log(`Skipping ${file} (not found)`);
      continue;
    }

    console.log(`Importing ${file}...`);
    let batch: NdjsonRecord[] = [];
    let fileImported = 0;
    const rl = createLineReader(createReadStream(file));

    const tick = createProgressCounter(500_000, (count) => {
      console.log(`  ${count.toLocaleString()} imported from ${category}`);
    });

    const flush = () => {
      database.exec('BEGIN');
      for (const r of batch) {
        const views = r.wikipedia
          ? (pageviews.get(extractTitle(r.wikipedia) ?? '') ?? 0)
          : 0;

        /* eslint-disable unicorn/no-null -- SQLite requires null for NULL values */
        insert.run(
          r.qid,
          r.label,
          r.description ?? null,
          r.type ?? null,
          category,
          r.sitelinkCount,
          views,
          r.wikipedia ? normalizeWikiUrl(r.wikipedia) : null,
          r.wikidata ?? null,
          random(),
        );
        /* eslint-enable unicorn/no-null */
      }
      database.exec('COMMIT');
      fileImported += batch.length;
      totalImported += batch.length;
      batch = [];
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      tick();
      const record = JSON.parse(line) as NdjsonRecord;
      batch.push(record);
      if (batch.length >= BATCH_SIZE) flush();
    }

    if (batch.length > 0) flush();
    console.log(
      `  Done: ${fileImported.toLocaleString()} records from ${category}`,
    );
  }

  console.log('Running ANALYZE...');
  database.exec('PRAGMA journal_mode=WAL;');
  database.exec('ANALYZE;');
  database.close();

  console.log(
    `Import complete: ${totalImported.toLocaleString()} total records`,
  );
}

const missing = [...SOURCES.map((s) => s.file), PAGEVIEWS_PATH].filter(
  (f) => !existsSync(f),
);
if (missing.length > 0) {
  console.error('Missing required data files:');
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}

try {
  await buildDatabase();
} catch (error) {
  console.error('Fatal:', error);
  process.exit(1);
}
