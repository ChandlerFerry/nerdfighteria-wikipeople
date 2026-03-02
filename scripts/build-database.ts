#!/usr/bin/env node

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { importData } from '../src/database/import.js';

const REQUIRED_FILES = [
  'data/humans.ndjson',
  'data/fictional.ndjson',
  'data/apocryphal.ndjson',
  'data/pageviews.ndjson',
];

async function loadPageviews(): Promise<Map<string, number>> {
  console.log('Loading pageview data...');
  const map = new Map<string, number>();

  const rl = createInterface({
    input: createReadStream('data/pageviews.ndjson'),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
}
