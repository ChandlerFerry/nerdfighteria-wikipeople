#!/usr/bin/env node

import { fetchPage } from "./lib/wikidata.js";
import * as queries from "./lib/queries.js";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

const PAGE_SIZE = process.env.LIMIT ? Number(process.env.LIMIT) : 100;
const SLEEP_MS = 500;
const RETRY_MAX = 6;
const RETRY_BASE_MS = 10_000;
const DATA_DIR = "data";
const PROGRESS_FILE = join(DATA_DIR, ".progress.json");

const CATEGORIES = [
  { name: "humans",    query: queries.humans,    file: join(DATA_DIR, "humans.ndjson") },
  { name: "fictional", query: queries.fictional,  file: join(DATA_DIR, "fictional.ndjson") },
  { name: "historical",query: queries.historical, file: join(DATA_DIR, "historical.ndjson") },
] as const;

type CategoryName = typeof CATEGORIES[number]["name"];
type Progress = Record<CategoryName, { offset: number; done: boolean; total: number }>;

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) return JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) as Progress;
  return Object.fromEntries(
    CATEGORIES.map(({ name }) => [name, { offset: 0, done: false, total: 0 }]),
  ) as Progress;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/\b(429|500|502|503|504)\b/.test(message) || attempt >= RETRY_MAX) throw error;
    const delay = RETRY_BASE_MS * 2 ** attempt;
    console.warn(`  ⚠ ${message.slice(0, 80)} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${RETRY_MAX})...`);
    await sleep(delay);
    return withRetry(fn, attempt + 1);
  }
}

async function collect(target: string) {
  mkdirSync(DATA_DIR, { recursive: true });
  const progress = loadProgress();
  const save = () => writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

  for (const { name, query, file } of CATEGORIES) {
    if (target !== "all" && target !== name) continue;
    const cat = progress[name];

    if (cat.done) {
      console.log(`[${name}] Already complete (${cat.total} records), skipping.`);
      continue;
    }

    const stream = createWriteStream(file, { flags: "a" });
    try {
      while (true) {
        console.log(`[${name}] offset=${cat.offset}...`);
        const results = await withRetry(() => fetchPage(query(PAGE_SIZE, cat.offset)));
        for (const result of results) stream.write(JSON.stringify(result) + "\n");
        cat.offset += PAGE_SIZE;
        cat.total += results.length;
        save();
        console.log(`  ✔ ${results.length} records (${cat.total} total)`);
        if (results.length < PAGE_SIZE) {
          cat.done = true;
          save();
          console.log(`[${name}] Complete — ${cat.total} records.\n`);
          break;
        }
        await sleep(SLEEP_MS);
      }
    } finally {
      await new Promise<void>((resolve) => stream.end(resolve));
    }
  }
}

async function merge() {
  const out = createWriteStream(join(DATA_DIR, "all.ndjson"));
  const seen = new Set<string>();
  let total = 0;
  let dupes = 0;

  for (const { name, file } of CATEGORIES) {
    if (!existsSync(file)) { console.log(`Skipping ${file} (not found)`); continue; }
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line) as { qid: string };
      if (seen.has(obj.qid)) { dupes++; continue; }
      seen.add(obj.qid);
      out.write(JSON.stringify({ ...obj, category: name }) + "\n");
      total++;
    }
    console.log(`Merged ${file}`);
  }

  await new Promise<void>((resolve) => out.end(resolve));
  console.log(`\n→ data/all.ndjson: ${total} unique, ${dupes} duplicates removed.`);
}

const cmd = process.argv[2] ?? "all";
(cmd === "merge" ? merge() : collect(cmd)).catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
