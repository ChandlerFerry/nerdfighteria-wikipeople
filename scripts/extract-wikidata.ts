#!/usr/bin/env node

import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { createLineReader } from './utils/line-reader.js';
import { createProgressCounter } from './utils/progress.js';

const DATA_DIR = 'data';
const DUMP_PATH = 'latest-all.json.gz';

const CLASSES: Record<string, { category: string; type: string | undefined }> =
  {
    Q5: { category: 'humans', type: undefined },
    Q95074: { category: 'fictional', type: 'fictional character' },
    Q15632617: { category: 'fictional', type: 'fictional human' },
    Q4271324: { category: 'fictional', type: 'mythical character' },
    Q15773347: { category: 'fictional', type: 'film character' },
    Q15773317: { category: 'fictional', type: 'television character' },
    Q3658341: { category: 'fictional', type: 'literary character' },
    Q50386450: { category: 'fictional', type: 'operatic character' },
    Q1569167: { category: 'fictional', type: 'video game character' },
    Q80447738: { category: 'fictional', type: 'anime character' },
    Q1114461: { category: 'fictional', type: 'comics character' },
    Q87576284: { category: 'fictional', type: 'manga character' },
    Q63975020: { category: 'fictional', type: 'musical theatre character' },
    Q15711870: { category: 'fictional', type: 'animated character' },
    Q22988604: { category: 'fictional', type: 'mythological Greek character' },
    Q3375722: { category: 'fictional', type: 'theatrical character' },
    Q386208: { category: 'fictional', type: 'mascot character' },
    Q20643955: { category: 'fictional', type: 'human biblical figure' },
    Q28020127: { category: 'fictional', type: 'fictional humanoid' },
    Q123126876: {
      category: 'fictional',
      type: 'animated television character',
    },
    Q17624054: { category: 'fictional', type: 'fictional deity' },
    Q13002315: { category: 'fictional', type: 'legendary figure' },
    Q108065012: { category: 'fictional', type: 'radio character' },
    Q25810847: { category: 'fictional', type: 'folklore character' },
    Q21070568: { category: 'apocryphal', type: undefined },
  };

interface Entity {
  type: string;
  id: string;
  labels?: { en?: { value: string } };
  descriptions?: { en?: { value: string } };
  claims?: {
    P31?: Array<{
      rank: string;
      mainsnak: { snaktype: string; datavalue?: { value: { id: string } } };
    }>;
  };
  sitelinks?: Record<string, { title: string }>;
}

interface Result {
  qid: string;
  label: string;
  description: string | undefined;
  type: string | undefined;
  sitelinkCount: number;
  wikipedia: string | undefined;
  wikidata: string;
}

function matchClass(
  entity: Entity
): { qid: string; category: string; type: string | undefined } | undefined {
  for (const claim of entity.claims?.P31 ?? []) {
    if (claim.rank === 'deprecated' || claim.mainsnak.snaktype !== 'value')
      continue;
    const id = claim.mainsnak.datavalue?.value?.id;
    if (id && id in CLASSES) return { qid: id, ...CLASSES[id] };
  }
  return undefined;
}

function toResult(
  entity: Entity,
  type: string | undefined
): Result | undefined {
  const label = entity.labels?.en?.value;
  if (!label) return undefined;
  const wikiTitle = entity.sitelinks?.enwiki?.title;
  return {
    qid: entity.id,
    label,
    description: entity.descriptions?.en?.value,
    type,
    sitelinkCount: Object.keys(entity.sitelinks ?? {}).length,
    wikipedia: wikiTitle
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`
      : undefined,
    wikidata: `https://www.wikidata.org/wiki/${entity.id}`,
  };
}

async function processDump() {
  mkdirSync(DATA_DIR, { recursive: true });

  const out = {
    humans: createWriteStream(path.join(DATA_DIR, 'humans.ndjson')),
    fictional: createWriteStream(path.join(DATA_DIR, 'fictional.ndjson')),
    apocryphal: createWriteStream(path.join(DATA_DIR, 'apocryphal.ndjson')),
  };

  const rl = createLineReader(createReadStream(DUMP_PATH).pipe(createGunzip()));

  let matched = 0;
  const matchCounts: Record<string, number> = Object.fromEntries(
    Object.keys(CLASSES).map((qid) => [qid, 0])
  );

  const tick = createProgressCounter(1_000_000, (count) => {
    console.log(
      `  ${(count / 1_000_000).toFixed(0)}M processed, ${matched.toLocaleString()} matched`
    );
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '[' || trimmed === ']' || trimmed === '') continue;

    let entity: Entity;
    try {
      entity = JSON.parse(
        trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed
      ) as Entity;
    } catch {
      continue;
    }

    if (entity.type === 'item') {
      const match = matchClass(entity);
      if (match) {
        const result = toResult(entity, match.type);
        if (result) {
          out[match.category as keyof typeof out].write(
            JSON.stringify(result) + '\n'
          );
          matched++;
          matchCounts[match.qid]++;
        }
      }
    }

    tick();
  }

  await Promise.all(
    Object.values(out).map(
      (s) => new Promise<void>((resolve) => s.end(resolve))
    )
  );
  console.log(
    `\nDone. ${matched.toLocaleString()} matched.\n`
  );

  console.log('Per-QID breakdown:');
  const maxLabel = Math.max(
    ...Object.values(CLASSES).map((c) => (c.type ?? c.category).length)
  );
  for (const [qid, cls] of Object.entries(CLASSES)) {
    const count = matchCounts[qid];
    const label = (cls.type ?? cls.category).padEnd(maxLabel);
    console.log(
      `  ${qid.padEnd(12)} ${label}  ${count.toLocaleString()}${count === 0 ? '  ← no hits' : ''}`
    );
  }
}

try {
  await processDump();
} catch (error) {
  console.error('Fatal:', error);
  process.exit(1);
}
