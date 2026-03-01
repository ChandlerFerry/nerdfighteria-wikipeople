#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { execFileSync, spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { get } from "node:https";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const NDJSON_PATH = "data/pageviews.ndjson";
const TMP_DIR = "data/pageviews-tmp";
const ACCUM_DB_PATH = "data/pageviews-tmp/accumulator.db";
const BATCH_SIZE = 10_000;
const BASE_URL = "https://dumps.wikimedia.org/other/pageview_complete/monthly";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ensureBzcat(): void {
  try {
    execFileSync("bzcat", ["--help"], { stdio: "ignore" });
  } catch {
    console.error("Error: bzcat is required but not found. Install bzip2.");
    process.exit(1);
  }
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchText(response.headers.location).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      let data = "";
      response.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      response.on("end", () => resolve(data));
      response.on("error", reject);
    }).on("error", reject);
  });
}

function downloadFile(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const file = createWriteStream(destination);
      pipeline(response, file).then(resolve, reject);
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Accumulator: temp SQLite DB to avoid Map size limits
// ---------------------------------------------------------------------------

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
  `);
  return database;
}

// ---------------------------------------------------------------------------
// Extract: download .bz2 dumps → data/pageviews.ndjson
// ---------------------------------------------------------------------------

function processBz2Stream(filePath: string, database: DatabaseSync): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bzcat", [filePath], { stdio: ["ignore", "pipe", "ignore"] });

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
      database.exec("BEGIN");
      for (const [title, views] of batch) {
        upsert.run(title, views);
      }
      database.exec("COMMIT");
      batch = [];
    };

    rl.on("line", (line: string) => {
      lines++;
      if (lines % 10_000_000 === 0) {
        console.log(`  ${(lines / 1_000_000).toFixed(0)}M lines, ${matched.toLocaleString()} matched`);
      }

      // Format: wiki_code title [page_id] daily_total hourly_counts
      // daily_total is always the second-to-last field
      if (!line.startsWith("en.wikipedia ")) return;

      const fields = line.split(" ");
      if (fields.length < 4) return;

      const title = fields[1];
      const dailyTotal = Number.parseInt(fields.at(-2)!, 10);
      if (Number.isNaN(dailyTotal) || dailyTotal <= 0) return;

      matched++;
      batch.push([title, dailyTotal]);
      if (batch.length >= BATCH_SIZE) flush();
    });

    rl.on("close", () => {
      if (batch.length > 0) flush();
      console.log(`  Processed ${(lines / 1_000_000).toFixed(1)}M lines, ${matched.toLocaleString()} matched.`);
      resolve();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`bzcat exited with code ${code}`));
      }
    });
  });
}

async function discoverDumpUrls(): Promise<string[]> {
  console.log("Discovering available monthly dump files...");
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
      const fileMatches = [...monthHtml.matchAll(/href="(pageviews-\d{6}-user\.bz2)"/g)];
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
  const count = (database.prepare("SELECT COUNT(*) AS n FROM pageviews").get() as { n: number }).n;
  console.log(`Writing ${count.toLocaleString()} entries to ${NDJSON_PATH}...`);

  mkdirSync("data", { recursive: true });
  const out = createWriteStream(NDJSON_PATH);
  const rows = database.prepare("SELECT title, views FROM pageviews").all() as Array<{ title: string; views: number }>;

  for (const row of rows) {
    out.write(JSON.stringify(row) + "\n");
  }

  out.end();
  console.log(`Done. Wrote ${NDJSON_PATH}`);
}

async function extract(): Promise<void> {
  ensureBzcat();

  const urls = await discoverDumpUrls();
  mkdirSync(TMP_DIR, { recursive: true });

  const database = openAccumulator();

  for (const url of urls) {
    const filename = url.split("/").pop()!;
    const destination = `${TMP_DIR}/${filename}`;
    console.log(`\nDownloading: ${filename}`);

    try {
      await downloadFile(url, destination);
      console.log(`Processing: ${filename}`);
      await processBz2Stream(destination, database);
    } finally {
      if (existsSync(destination)) {
        rmSync(destination);
        console.log(`Cleaned up: ${filename}`);
      }
    }
  }

  writeNdjson(db);
  database.close();

  try {
    rmSync(TMP_DIR, { recursive: true });
  } catch {
    // ignore
  }

  console.log("\nExtraction complete.");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await extract();
  } catch (error) {
    console.error("Fatal:", error);
    process.exit(1);
  }
}
