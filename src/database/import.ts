import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './connection.js';
import { SCHEMA } from './schema.js';
import type { Category } from './types.js';

const BATCH_SIZE = 10_000;

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

export async function importData(
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

  const sources: Array<{ file: string; category: Category; dedup?: boolean }> =
    [
      { file: 'data/humans.ndjson', category: 'humans' },
      { file: 'data/fictional.ndjson', category: 'fictional' },
      { file: 'data/historical.ndjson', category: 'historical' },
      {
        file: 'data/fictional_wikipedia.ndjson',
        category: 'fictional_wikipedia',
        dedup: true,
      },
    ];

  const dedupStmt = database.prepare(
    'SELECT 1 FROM entities WHERE wikipedia = ? LIMIT 1'
  );

  let totalImported = 0;

  for (const { file, category, dedup } of sources) {
    if (!existsSync(file)) {
      console.log(`Skipping ${file} (not found)`);
      continue;
    }

    console.log(`Importing ${file}...`);
    let batch: NdjsonRecord[] = [];
    let fileImported = 0;
    let dedupSkipped = 0;

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
        const normalizedWiki = r.wikipedia
          ? normalizeWikiUrl(r.wikipedia)
          : null;

        insert.run(
          r.qid,
          r.label,
          r.description ?? null,
          r.type ?? null,
          category,
          r.sitelinkCount,
          views,
          normalizedWiki,
          r.wikidata ?? null,
          Math.random()
        );
        /* eslint-enable unicorn/no-null */
      }
      database.exec('COMMIT');
      fileImported += batch.length;
      totalImported += batch.length;
      batch = [];
      if (fileImported % 500_000 === 0) {
        console.log(
          `  ${fileImported.toLocaleString()} imported from ${category}`
        );
      }
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as NdjsonRecord;
      if (
        dedup &&
        record.wikipedia &&
        dedupStmt.get(normalizeWikiUrl(record.wikipedia))
      ) {
        dedupSkipped++;
        continue;
      }
      batch.push(record);
      if (batch.length >= BATCH_SIZE) flush();
    }

    if (batch.length > 0) flush();
    const skipNote =
      dedupSkipped > 0
        ? `, ${dedupSkipped.toLocaleString()} dedup-skipped`
        : '';
    console.log(
      `  Done: ${fileImported.toLocaleString()} records from ${category}${skipNote}`
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
