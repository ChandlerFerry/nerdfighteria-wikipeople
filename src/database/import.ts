import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./connection.js";
import { SCHEMA } from "./schema.js";
import type { Category } from "./types.js";

const BATCH_SIZE = 10_000;

interface NdjsonRecord {
  qid: string;
  label: string;
  description?: string | null;
  type?: string | null;
  sitelinkCount: number;
  wikipedia?: string | null;
  wikidata: string;
}

export async function importData(): Promise<void> {
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
      (qid, label, description, type, category, sitelink_count, wikipedia, wikidata, rand)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sources: Array<{ file: string; category: Category }> = [
    { file: "data/humans.ndjson",     category: "humans" },
    { file: "data/fictional.ndjson",  category: "fictional" },
    { file: "data/historical.ndjson", category: "historical" },
  ];

  let totalImported = 0;

  for (const { file, category } of sources) {
    console.log(`Importing ${file}...`);
    let batch: NdjsonRecord[] = [];
    let fileImported = 0;

    const rl = createInterface({
      input: createReadStream(file),
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    const flush = () => {
      database.exec("BEGIN");
      for (const r of batch) {
        insert.run(r.qid, r.label, r.description ?? null, r.type ?? null, category, r.sitelinkCount, r.wikipedia ?? null, r.wikidata, Math.random());
      }
      database.exec("COMMIT");
      fileImported += batch.length;
      totalImported += batch.length;
      batch = [];
      if (fileImported % 500_000 === 0) {
        console.log(`  ${fileImported.toLocaleString()} imported from ${category}`);
      }
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      batch.push(JSON.parse(line) as NdjsonRecord);
      if (batch.length >= BATCH_SIZE) flush();
    }

    if (batch.length > 0) flush();
    console.log(`  Done: ${fileImported.toLocaleString()} records from ${category}`);
  }

  console.log("Running ANALYZE...");
  database.exec("PRAGMA journal_mode=WAL;");
  database.exec("ANALYZE;");
  database.close();

  console.log(`Import complete: ${totalImported.toLocaleString()} total records`);
}
