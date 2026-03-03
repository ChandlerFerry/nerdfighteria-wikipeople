#!/usr/bin/env node

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../src/database/connection.js';
import { SCHEMA } from '../src/database/schema.js';
import type { Category } from '../src/database/types.js';
import { createLineReader } from './utils/line-reader.js';

const BATCH_SIZE = 10_000;
const LOG_INTERVAL = 500_000;

const REQUIRED_FILES = [
  'data/humans.ndjson',
  'data/fictional.ndjson',
  'data/apocryphal.ndjson',
  'data/pageviews.ndjson',
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
      '_'
    );
  } catch {
    return undefined;
  }
}

function normalizeWikiUrl(wikipedia: string): string {
  const title = extractTitle(wikipedia);
  return title ? `https://en.wikipedia.org/wiki/${title}` : wikipedia;
}

async function loadPageviews(): Promise<Map<string, number>> {
  console.log('Loading pageview data...');
  const map = new Map<string, number>();

  const rl = createLineReader(createReadStream('data/pageviews.ndjson'));

  for await (const line of rl) {
    if (!line.trim()) continue;
    const { title, views } = JSON.parse(line) as {
      title: string;
      views: number;
    };
    map.set(title, views);
  }

  console.log(`Loaded ${map.size.toLocaleString()} pageview entries.`);
  return map;
}

async function importData(
  pageviews?: Map<string, number>
): Promise<void> {
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

  const sources: Array<{ file: string; category: Category }> = [
    { file: 'data/humans.ndjson', category: 'humans' },
    { file: 'data/fictional.ndjson', category: 'fictional' },
    { file: 'data/apocryphal.ndjson', category: 'apocryphal' },
  ];

  let totalImported = 0;

  for (const { file, category } of sources) {
    if (!existsSync(file)) {
      console.log(`Skipping ${file} (not found)`);
      continue;
    }

    console.log(`Importing ${file}...`);
    let batch: NdjsonRecord[] = [];
    let fileImported = 0;
    const rl = createInterface({
      input: createReadStream(file),
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    const flush = () => {
      database.exec('BEGIN');
      for (const r of batch) {
        const views =
          r.wikipedia && pageviews
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
          Math.random()
        );
        /* eslint-enable unicorn/no-null */
      }
      database.exec('COMMIT');
      fileImported += batch.length;
      totalImported += batch.length;
      batch = [];
      if (fileImported % LOG_INTERVAL === 0) {
        console.log(
          `  ${fileImported.toLocaleString()} imported from ${category}`
        );
      }
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as NdjsonRecord;
      batch.push(record);
      if (batch.length >= BATCH_SIZE) flush();
    }

    if (batch.length > 0) flush();
    console.log(
      `  Done: ${fileImported.toLocaleString()} records from ${category}`
    );
  }

  console.log('Running ANALYZE...');
  database.exec('PRAGMA journal_mode=WAL;');
  database.exec('ANALYZE;');
  database.close();

  console.log(
    `Import complete: ${totalImported.toLocaleString()} total records`
  );
}

const missing = REQUIRED_FILES.filter((f) => !existsSync(f));
if (missing.length > 0) {
  console.error('Missing required data files:');
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}

try {
  const pageviews = await loadPageviews();
  await importData(pageviews);
} catch (error) {
  console.error('Fatal:', error);
  process.exit(1);
}
