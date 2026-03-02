#!/usr/bin/env node

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadFile } from './utils/download.js';

const DATA_DIR = 'data';
const OUTPUT_FILE = 'fictional_wikipedia.ndjson';
const WIKIMEDIA_BASE = 'https://dumps.wikimedia.org/enwiki/latest';

const WORK_KEYWORDS = [
  'novel',
  'film',
  'movie',
  'television',
  'anime',
  'manga',
  'comic',
  'game',
  'fiction',
  'story',
];

const NAME_PARTICLES = new Set([
  'de', 'del', 'della', 'di', 'das', 'dos', 'do',
  'von', 'van', 'den', 'der', 'het',
  'la', 'le', 'les', 'el',
  'du', 'des',
  'al', 'bin', 'ibn', 'ben', 'bint', 'abu',
  'y', 'e', 'i',
  'a', 'o', 'na', 'ni', 'no',
  'mac', 'mc',
  'the', 'of', 'and',
]);

const PAGE_COL = { id: 0, ns: 1, title: 2, redirect: 3 } as const;
const LT_COL = { id: 0, ns: 1, title: 2 } as const;
const CL_COL = { from: 0, type: 4, targetId: 6 } as const;
const REDIRECT_COL = { from: 0, ns: 1, title: 2, fragment: 4 } as const;

interface WikipediaResult {
  qid: string;
  label: string;
  sitelinkCount: number;
  wikipedia: string;
}

function createTableParser(
  tableName: string,
  onTuple: (fields: string[]) => void
): (chunk: Buffer) => void {
  const marker = `INSERT INTO \`${tableName}\` VALUES `;
  const mlen = marker.length;

  let scanning = true;
  let scanBuf = '';
  let between = true;
  let inString = false;
  let afterBs = false;
  let current = '';
  let fields: string[] = [];
  let depth = 0;

  function resetTuple() {
    between = true;
    inString = false;
    afterBs = false;
    current = '';
    fields = [];
    depth = 0;
  }

  return function process(chunk: Buffer): void {
    let string_: string;
    let start = 0;

    if (scanning) {
      const combined = scanBuf + chunk.toString('latin1');
      const index = combined.indexOf(marker);
      if (index === -1) {
        scanBuf =
          combined.length >= mlen ? combined.slice(-(mlen - 1)) : combined;
        return;
      }
      scanning = false;
      scanBuf = '';
      string_ = combined;
      start = index + mlen;
    } else {
      string_ = chunk.toString('latin1');
    }

    for (let index = start; index < string_.length; index++) {
      const ch = string_[index];

      if (afterBs) {
        switch (ch) {
          case 'n': {
            current += '\n';
            break;
          }
          case 'r': {
            current += '\r';
            break;
          }
          case 't': {
            current += '\t';
            break;
          }
          default: {
            current += ch;
            break;
          }
        }
        afterBs = false;
        continue;
      }

      if (inString) {
        if (ch === '\\') {
          afterBs = true;
        } else if (ch === "'") {
          if (string_[index + 1] === "'") {
            current += "'";
            index++;
          } else {
            inString = false;
          }
        } else {
          current += ch;
        }
        continue;
      }

      if (between) {
        if (ch === '(') {
          between = false;
        } else if (ch === ';') {
          const rest = string_.slice(index + 1);
          const nextMarker = rest.indexOf(marker);
          resetTuple();
          if (nextMarker === -1) {
            scanning = true;
            scanBuf = rest.length >= mlen ? rest.slice(-(mlen - 1)) : rest;
            return;
          }
          index = index + nextMarker + mlen;
        }
        continue;
      }

      if (ch === "'") {
        inString = true;
      } else if (ch === ',' && depth === 0) {
        fields.push(current);
        current = '';
      } else if (ch === ')' && depth === 0) {
        fields.push(current);
        onTuple(fields);
        resetTuple();
      } else if (ch === '(') {
        depth++;
        current += ch;
      } else if (ch === ')') {
        depth--;
        current += ch;
      } else {
        current += ch;
      }
    }
  };
}

async function streamTable(
  filePath: string,
  parser: (chunk: Buffer) => void
): Promise<void> {
  const gz = createReadStream(filePath).pipe(createGunzip());
  for await (const chunk of gz) parser(chunk as Buffer);
}

const CHARACTER_FRAGMENT_KEYWORDS = [
  'character',
  'cast',
  'protagonist',
  'antagonist',
  'villain',
  // 'hero', // Broke on https://en.wikipedia.org/wiki/Dune_prequel_series#Heroes_of_Dune
  'persona',
  'fictional',
];

function hasCharacterKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return CHARACTER_FRAGMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

function looksLikeCharacterName(title: string): boolean {
  if (/[!:?;.,()[\]]/.test(title)) return false;
  const words = title.split('_');
  if (words.length < 2 || words.length > 4) return false;

  let capitalizedCount = 0;
  for (const word of words) {
    if (/\d/.test(word)) return false;
    if (word.length > 1 && word === word.toUpperCase()) return false;

    if (NAME_PARTICLES.has(word.toLowerCase())) continue;

    if (word[0] !== word[0].toUpperCase()) return false;
    capitalizedCount++;
  }

  return capitalizedCount >= 2;
}

async function buildWorkLtIds(
  filePath: string
): Promise<Set<number>> {
  console.log(`\nPass 1: linktarget → workLtIds`);
  const workLtIds = new Set<number>();
  let rows = 0;

  const parse = createTableParser('linktarget', (fields) => {
    if (Number.parseInt(fields[LT_COL.ns], 10) !== 14) return;
    const title = fields[LT_COL.title];
    const ltId = Number.parseInt(fields[LT_COL.id], 10);

    const lower = title.toLowerCase();
    if (WORK_KEYWORDS.some((kw) => lower.includes(kw))) workLtIds.add(ltId);

    if (++rows % 1_000_000 === 0)
      console.log(
        `  ${rows / 1_000_000}M ns-14 rows, ${workLtIds.size.toLocaleString()} work`
      );
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: workLtIds=${workLtIds.size.toLocaleString()}`
  );
  return workLtIds;
}

async function buildWorkIds(
  filePath: string,
  workLtIds: Set<number>
): Promise<Set<number>> {
  console.log(`\nPass 2: categorylinks → workIds`);
  const workIds = new Set<number>();
  let rows = 0;

  const parse = createTableParser('categorylinks', (fields) => {
    if (fields[CL_COL.type] !== 'page') return;
    const targetId = Number.parseInt(fields[CL_COL.targetId], 10);
    if (workLtIds.has(targetId))
      workIds.add(Number.parseInt(fields[CL_COL.from], 10));

    if (++rows % 1_000_000 === 0)
      console.log(
        `  ${rows / 1_000_000}M rows, workIds=${workIds.size.toLocaleString()}`
      );
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: workIds=${workIds.size.toLocaleString()}`
  );
  return workIds;
}

async function buildWorkTitleToPageId(
  filePath: string,
  workIds: Set<number>
): Promise<Map<string, number>> {
  console.log(`\nPass 3: page → workTitleToPageId`);
  const workTitleToPageId = new Map<string, number>();
  let rows = 0;

  const parse = createTableParser('page', (fields) => {
    if (Number.parseInt(fields[PAGE_COL.ns], 10) !== 0) return;
    if (fields[PAGE_COL.redirect] === '1') return;
    const pageId = Number.parseInt(fields[PAGE_COL.id], 10);
    if (workIds.has(pageId))
      workTitleToPageId.set(fields[PAGE_COL.title], pageId);
    if (++rows % 1_000_000 === 0)
      console.log(
        `  ${rows / 1_000_000}M article rows, workTitles=${workTitleToPageId.size.toLocaleString()}`
      );
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: workTitleToPageId=${workTitleToPageId.size.toLocaleString()}`
  );
  return workTitleToPageId;
}

async function fetchCharacterRedirectIds(
  filePath: string,
  workTitleToPageId: Map<string, number>
): Promise<Map<number, string>> {
  console.log(`\nPass 4: redirect → character redirect page_ids + fragments`);
  const charRedirectFragments = new Map<number, string>();
  let rows = 0;

  const parse = createTableParser('redirect', (fields) => {
    if (Number.parseInt(fields[REDIRECT_COL.ns], 10) !== 0) return;
    const target = fields[REDIRECT_COL.title];
    if (!workTitleToPageId.has(target)) return;
    const frag = fields[REDIRECT_COL.fragment];
    const rawFrag = frag === 'NULL' || frag === '' ? '' : frag;
    if (
      rawFrag === '' ||
      (!hasCharacterKeyword(rawFrag) && !looksLikeCharacterName(rawFrag))
    )
      return;
    const pageId = Number.parseInt(fields[REDIRECT_COL.from], 10);
    charRedirectFragments.set(pageId, rawFrag);
    if (++rows % 100_000 === 0)
      console.log(`  ${(rows / 1_000_000).toFixed(1)}M matched redirects`);
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: ${charRedirectFragments.size.toLocaleString()} character redirects with fragments`
  );
  return charRedirectFragments;
}

async function fetchRedirectTitles(
  filePath: string,
  charRedirectFragments: Map<number, string>
): Promise<Map<number, string>> {
  console.log(
    `\nPass 5: page → titles for ${charRedirectFragments.size.toLocaleString()} character redirects`
  );
  const charRedirectTitles = new Map<number, string>();
  let rows = 0;

  const parse = createTableParser('page', (fields) => {
    if (Number.parseInt(fields[PAGE_COL.ns], 10) !== 0) return;
    if (fields[PAGE_COL.redirect] !== '1') return;
    const pageId = Number.parseInt(fields[PAGE_COL.id], 10);
    if (charRedirectFragments.has(pageId))
      charRedirectTitles.set(pageId, fields[PAGE_COL.title]);
    if (++rows % 1_000_000 === 0)
      console.log(
        `  ${rows / 1_000_000}M redirect pages, ${charRedirectTitles.size.toLocaleString()} found`
      );
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: ${charRedirectTitles.size.toLocaleString()} redirect titles`
  );
  return charRedirectTitles;
}

async function writeOutput(
  charRedirectTitles: Map<number, string>
): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const outPath = `${DATA_DIR}/${OUTPUT_FILE}`;
  console.log(`\nWriting output to ${outPath}...`);

  const out = createWriteStream(outPath);
  const writtenQids = new Set<string>();
  let written = 0;
  let skipped = 0;

  for (const title of charRedirectTitles.values()) {
    if (
      title.includes('(disambiguation)') ||
      title.startsWith('List_of') ||
      title.startsWith('Lists_of') ||
      title.includes('(') ||
      title.includes('/')
    ) {
      skipped++;
      continue;
    }

    const utf8Title = Buffer.from(title, 'latin1').toString('utf8');
    const qid = `enwiki:${utf8Title}`;
    if (writtenQids.has(qid)) {
      skipped++;
      continue;
    }
    writtenQids.add(qid);

    const record: WikipediaResult = {
      qid,
      label: utf8Title.replaceAll('_', ' '),
      sitelinkCount: 1,
      wikipedia: `https://en.wikipedia.org/wiki/${encodeURIComponent(utf8Title)}`,
    };
    out.write(JSON.stringify(record) + '\n');
    written++;
  }

  await new Promise<void>((resolve) => out.end(resolve));
  console.log(
    `  Written: ${written.toLocaleString()} records, skipped: ${skipped.toLocaleString()}`
  );
}

async function downloadIfMissing(filePath: string): Promise<void> {
  if (existsSync(filePath)) {
    console.log(`  ${filePath} already exists, skipping download`);
    return;
  }
  const url = `${WIKIMEDIA_BASE}/${path.basename(filePath)}`;
  console.log(`Downloading ${url} → ${filePath} ...`);
  await downloadFile(url, filePath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pageDump = process.argv[2];
  const categoryLinksDump = process.argv[3];
  const linktargetDump = process.argv[4];
  const redirectDump = process.argv[5];

  if (!pageDump || !categoryLinksDump || !linktargetDump || !redirectDump) {
    console.error(
      'Usage: tsx scripts/jank-extract-wikipedia.ts <page.sql.gz> <categorylinks.sql.gz> <linktarget.sql.gz> <redirect.sql.gz>'
    );
    process.exit(1);
  }

  try {
    await downloadIfMissing(pageDump);
    await downloadIfMissing(categoryLinksDump);
    await downloadIfMissing(linktargetDump);
    await downloadIfMissing(redirectDump);

    const workLtIds = await buildWorkLtIds(linktargetDump);

    const workIds = await buildWorkIds(categoryLinksDump, workLtIds);
    workLtIds.clear();

    const workTitleToPageId = await buildWorkTitleToPageId(pageDump, workIds);
    workIds.clear();

    const charRedirectFragments = await fetchCharacterRedirectIds(
      redirectDump,
      workTitleToPageId
    );
    workTitleToPageId.clear();

    const charRedirectTitles = await fetchRedirectTitles(
      pageDump,
      charRedirectFragments
    );

    await writeOutput(charRedirectTitles);
    console.log('\nDone.');
  } catch (error) {
    console.error('Fatal:', error);
    process.exit(1);
  }
}
