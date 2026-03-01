#!/usr/bin/env node

import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importData } from "../src/database/import.js";

const DATA_DIR = "data";

const CLASSES: Record<string, { category: string; type: string | null }> = {
  Q5:        { category: "humans",     type: null },
  Q95074:    { category: "fictional",  type: "fictional character" },
  Q15632617: { category: "fictional",  type: "fictional human" },
  Q4271324:  { category: "fictional",  type: "mythical character" },
  Q15773347: { category: "fictional",  type: "fictional organism" },
  Q15773317: { category: "fictional",  type: "television character" },
  Q3658341:  { category: "fictional",  type: "literary character" },
  Q21070568: { category: "historical", type: null },
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
  description: string | null;
  type: string | null;
  sitelinkCount: number;
  wikipedia: string | null;
  wikidata: string;
}

function matchClass(entity: Entity): { category: string; type: string | null } | null {
  for (const claim of entity.claims?.P31 ?? []) {
    if (claim.rank === "deprecated" || claim.mainsnak.snaktype !== "value") continue;
    const id = claim.mainsnak.datavalue?.value?.id;
    if (id && id in CLASSES) return CLASSES[id];
  }
  return null;
}

function toResult(entity: Entity, type: string | null): Result | null {
  const label = entity.labels?.en?.value;
  if (!label) return null;
  const wikiTitle = entity.sitelinks?.enwiki?.title ?? null;
  return {
    qid: entity.id,
    label,
    description: entity.descriptions?.en?.value ?? null,
    type,
    sitelinkCount: Object.keys(entity.sitelinks ?? {}).length,
    wikipedia: wikiTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}` : null,
    wikidata: `https://www.wikidata.org/wiki/${entity.id}`,
  };
}

async function processDump(dumpPath: string) {
  mkdirSync(DATA_DIR, { recursive: true });

  const out = {
    humans:     createWriteStream(join(DATA_DIR, "humans.ndjson")),
    fictional:  createWriteStream(join(DATA_DIR, "fictional.ndjson")),
    historical: createWriteStream(join(DATA_DIR, "historical.ndjson")),
  };

  const rl = createInterface({
    input: createReadStream(dumpPath).pipe(createGunzip()),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  let processed = 0;
  let matched = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "[" || trimmed === "]" || trimmed === "") continue;

    let entity: Entity;
    try {
      entity = JSON.parse(trimmed.endsWith(",") ? trimmed.slice(0, -1) : trimmed) as Entity;
    } catch {
      continue;
    }

    if (entity.type === "item") {
      const match = matchClass(entity);
      if (match) {
        const result = toResult(entity, match.type);
        if (result) {
          out[match.category as keyof typeof out].write(JSON.stringify(result) + "\n");
          matched++;
        }
      }
    }

    if (++processed % 1_000_000 === 0) {
      console.log(`  ${(processed / 1_000_000).toFixed(0)}M processed, ${matched.toLocaleString()} matched`);
    }
  }

  await Promise.all(Object.values(out).map((s) => new Promise<void>((resolve) => s.end(resolve))));
  console.log(`\nDone. ${processed.toLocaleString()} entities processed, ${matched.toLocaleString()} matched.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];

  if (!cmd) {
    console.error("Usage: node --experimental-transform-types scripts/extract.ts <path-to-dump.json.gz>");
    console.error("       node --experimental-transform-types scripts/extract.ts import");
    process.exit(1);
  }

  let action: Promise<void>;

  action = cmd === "import" ? importData() : processDump(cmd);

  action.catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
  });
}
