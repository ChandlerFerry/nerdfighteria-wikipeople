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
const ROOT_CATEGORY = 'Fictional_characters';
const OUTPUT_FILE = 'fictional_wikipedia.ndjson';
const WIKIMEDIA_BASE = 'https://dumps.wikimedia.org/enwiki/latest';

const CHAR_BFS_KEYWORDS = [
  'fictional',
  'character',
  'comic',
  'manga',
  'anime',
  'fantasy',
  'fiction',
  'superhero',
  'animation',
  'animated',
  'mythology',
  'folklore',
  'legend',
];

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
const REDIRECT_COL = { from: 0, ns: 1, title: 2 } as const;

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

async function buildCatTitleToPageId(
  filePath: string
): Promise<Map<string, number>> {
  console.log(`\nPass 1: page → category title→page_id`);
  const catTitleToPageId = new Map<string, number>();
  let rows = 0;

  const parse = createTableParser('page', (fields) => {
    if (Number.parseInt(fields[PAGE_COL.ns], 10) !== 14) return;
    if (fields[PAGE_COL.redirect] === '1') return;
    catTitleToPageId.set(
      fields[PAGE_COL.title],
      Number.parseInt(fields[PAGE_COL.id], 10)
    );
    if (++rows % 500_000 === 0)
      console.log(`  ${(rows / 1_000_000).toFixed(1)}M category pages scanned`);
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: ${catTitleToPageId.size.toLocaleString()} category pages`
  );
  return catTitleToPageId;
}

async function buildLinktargetMaps(
  filePath: string,
  catTitleToPageId: Map<string, number>
): Promise<{
  rootLtId: number | undefined;
  catPageToLtId: Map<number, number>;
  workLtIds: Set<number>;
}> {
  console.log(`\nPass 2: linktarget → catPageToLtId + rootLtId + workLtIds`);
  const catPageToLtId = new Map<number, number>();
  const workLtIds = new Set<number>();
  let rootLtId: number | undefined;
  let rows = 0;

  const parse = createTableParser('linktarget', (fields) => {
    if (Number.parseInt(fields[LT_COL.ns], 10) !== 14) return;
    const title = fields[LT_COL.title];
    const ltId = Number.parseInt(fields[LT_COL.id], 10);

    if (title === ROOT_CATEGORY) rootLtId = ltId;

    const pageId = catTitleToPageId.get(title);
    if (pageId !== undefined) catPageToLtId.set(pageId, ltId);

    const lower = title.toLowerCase();
    if (WORK_KEYWORDS.some((kw) => lower.includes(kw))) workLtIds.add(ltId);

    if (++rows % 1_000_000 === 0)
      console.log(
        `  ${rows / 1_000_000}M ns-14 rows, ${catPageToLtId.size.toLocaleString()} mapped, ${workLtIds.size.toLocaleString()} work`
      );
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: catPageToLtId=${catPageToLtId.size.toLocaleString()}, workLtIds=${workLtIds.size.toLocaleString()}, rootLtId=${rootLtId}`
  );
  return { rootLtId, catPageToLtId, workLtIds };
}

async function buildCategoryMaps(
  filePath: string,
  workLtIds: Set<number>
): Promise<{ subcatEdges: Map<number, Set<number>>; workIds: Set<number> }> {
  console.log(`\nPass 3: categorylinks → subcatEdges + workIds`);
  const subcatEdges = new Map<number, Set<number>>();
  const workIds = new Set<number>();
  let rows = 0;

  const parse = createTableParser('categorylinks', (fields) => {
    const type = fields[CL_COL.type];
    const targetId = Number.parseInt(fields[CL_COL.targetId], 10);
    const fromId = Number.parseInt(fields[CL_COL.from], 10);

    if (type === 'subcat') {
      let set = subcatEdges.get(targetId);
      if (set === undefined) {
        set = new Set();
        subcatEdges.set(targetId, set);
      }
      set.add(fromId);
    } else if (type === 'page' && workLtIds.has(targetId)) {
      workIds.add(fromId);
    }

    if (++rows % 1_000_000 === 0)
      console.log(
        `  ${rows / 1_000_000}M rows, subcatEdges=${subcatEdges.size.toLocaleString()}, workIds=${workIds.size.toLocaleString()}`
      );
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: subcatEdges=${subcatEdges.size.toLocaleString()}, workIds=${workIds.size.toLocaleString()}`
  );
  return { subcatEdges, workIds };
}

function isFictionalCharCategory(title: string): boolean {
  const lower = title.toLowerCase();
  return CHAR_BFS_KEYWORDS.some((kw) => lower.includes(kw));
}

function looksLikeCharacterName(title: string): boolean {
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

function bfsFictionalLtIds(
  rootLtId: number,
  subcatEdges: Map<number, Set<number>>,
  catPageToLtId: Map<number, number>,
  catPageToTitle: Map<number, string>
): Set<number> {
  console.log(
    `\nBFS from "${ROOT_CATEGORY}" (lt_id=${rootLtId}) with keyword filter...`
  );
  const visited = new Set<number>();
  const queue: number[] = [rootLtId];

  while (queue.length > 0) {
    const ltId = queue.shift()!;
    if (visited.has(ltId)) continue;
    visited.add(ltId);

    const subcats = subcatEdges.get(ltId);
    if (!subcats) continue;

    for (const catPageId of subcats) {
      const childLtId = catPageToLtId.get(catPageId);
      if (childLtId === undefined || visited.has(childLtId)) continue;
      const title = catPageToTitle.get(catPageId) ?? '';
      if (isFictionalCharCategory(title)) queue.push(childLtId);
    }
  }

  console.log(
    `  Visited ${visited.size.toLocaleString()} fictional-character categories`
  );
  return visited;
}

async function collectFictionalArticleIds(
  filePath: string,
  fictionalLtIds: Set<number>
): Promise<Set<number>> {
  console.log(`\nPass 4: categorylinks → fictional character article page_ids`);
  const articleIds = new Set<number>();
  let rows = 0;

  const parse = createTableParser('categorylinks', (fields) => {
    if (fields[CL_COL.type] !== 'page') return;
    if (fictionalLtIds.has(Number.parseInt(fields[CL_COL.targetId], 10)))
      articleIds.add(Number.parseInt(fields[CL_COL.from], 10));
    if (++rows % 1_000_000 === 0)
      console.log(
        `  ${rows / 1_000_000}M page rows, ${articleIds.size.toLocaleString()} found`
      );
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: ${articleIds.size.toLocaleString()} fictional character article page_ids`
  );
  return articleIds;
}

async function buildPageMaps(
  filePath: string,
  articleIds: Set<number>,
  workIds: Set<number>
): Promise<{
  artTitles: Map<number, string>;
  workTitleToPageId: Map<string, number>;
}> {
  console.log(`\nPass 5: page → artTitles + workTitleToPageId`);
  const artTitles = new Map<number, string>();
  const workTitleToPageId = new Map<string, number>();
  let rows = 0;

  const parse = createTableParser('page', (fields) => {
    if (Number.parseInt(fields[PAGE_COL.ns], 10) !== 0) return;
    if (fields[PAGE_COL.redirect] === '1') return;
    const pageId = Number.parseInt(fields[PAGE_COL.id], 10);
    const title = fields[PAGE_COL.title];
    if (articleIds.has(pageId)) artTitles.set(pageId, title);
    if (workIds.has(pageId)) workTitleToPageId.set(title, pageId);
    if (++rows % 1_000_000 === 0)
      console.log(
        `  ${rows / 1_000_000}M article rows, artTitles=${artTitles.size.toLocaleString()}, workTitles=${workTitleToPageId.size.toLocaleString()}`
      );
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: artTitles=${artTitles.size.toLocaleString()}, workTitleToPageId=${workTitleToPageId.size.toLocaleString()}`
  );
  return { artTitles, workTitleToPageId };
}

async function fetchCharacterRedirectIds(
  filePath: string,
  workTitleToPageId: Map<string, number>
): Promise<Set<number>> {
  console.log(`\nPass 6: redirect → character redirect page_ids`);
  const charRedirectIds = new Set<number>();
  let rows = 0;

  const parse = createTableParser('redirect', (fields) => {
    if (Number.parseInt(fields[REDIRECT_COL.ns], 10) !== 0) return;
    if (!workTitleToPageId.has(fields[REDIRECT_COL.title])) return;
    charRedirectIds.add(Number.parseInt(fields[REDIRECT_COL.from], 10));
    if (++rows % 100_000 === 0)
      console.log(`  ${(rows / 1_000_000).toFixed(1)}M matched redirects`);
  });

  await streamTable(filePath, parse);
  console.log(
    `  Done: ${charRedirectIds.size.toLocaleString()} character redirect page_ids`
  );
  return charRedirectIds;
}

async function fetchRedirectTitles(
  filePath: string,
  charRedirectIds: Set<number>
): Promise<Map<number, string>> {
  console.log(
    `\nPass 7: page → titles for ${charRedirectIds.size.toLocaleString()} character redirects`
  );
  const charRedirectTitles = new Map<number, string>();
  let rows = 0;

  const parse = createTableParser('page', (fields) => {
    if (Number.parseInt(fields[PAGE_COL.ns], 10) !== 0) return;
    if (fields[PAGE_COL.redirect] !== '1') return;
    const pageId = Number.parseInt(fields[PAGE_COL.id], 10);
    if (charRedirectIds.has(pageId))
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
  artTitles: Map<number, string>,
  charRedirectTitles: Map<number, string>
): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const outPath = `${DATA_DIR}/${OUTPUT_FILE}`;
  console.log(`\nWriting output to ${outPath}...`);

  const out = createWriteStream(outPath);
  const writtenQids = new Set<string>();
  let written = 0;
  let skipped = 0;
  let nameFiltered = 0;

  function emit(title: string, isRedirect: boolean): void {
    if (
      title.includes('(disambiguation)') ||
      title.startsWith('List_of') ||
      title.startsWith('Lists_of')
    ) {
      skipped++;
      return;
    }
    if (isRedirect && (title.includes('(') || title.includes('/'))) {
      skipped++;
      return;
    }
    if (isRedirect && !looksLikeCharacterName(title)) {
      nameFiltered++;
      return;
    }

    const utf8Title = Buffer.from(title, 'latin1').toString('utf8');
    const qid = `enwiki:${utf8Title}`;
    if (writtenQids.has(qid)) {
      skipped++;
      return;
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

  for (const title of artTitles.values()) emit(title, false);
  for (const title of charRedirectTitles.values()) emit(title, true);

  await new Promise<void>((resolve) => out.end(resolve));
  console.log(
    `  Written: ${written.toLocaleString()} records, skipped: ${skipped.toLocaleString()}, nameFiltered: ${nameFiltered.toLocaleString()}`
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

    const catTitleToPageId = await buildCatTitleToPageId(pageDump);

    const catPageToTitle = new Map<number, string>();
    for (const [title, pageId] of catTitleToPageId)
      catPageToTitle.set(pageId, title);

    const { rootLtId, catPageToLtId, workLtIds } = await buildLinktargetMaps(
      linktargetDump,
      catTitleToPageId
    );
    catTitleToPageId.clear();
    if (rootLtId === undefined)
      throw new Error(`"${ROOT_CATEGORY}" not found in linktarget dump`);

    const { subcatEdges, workIds } = await buildCategoryMaps(
      categoryLinksDump,
      workLtIds
    );
    workLtIds.clear();

    const fictionalLtIds = bfsFictionalLtIds(
      rootLtId,
      subcatEdges,
      catPageToLtId,
      catPageToTitle
    );
    subcatEdges.clear();
    catPageToLtId.clear();
    catPageToTitle.clear();

    const articleIds = await collectFictionalArticleIds(
      categoryLinksDump,
      fictionalLtIds
    );
    fictionalLtIds.clear();

    const { artTitles, workTitleToPageId } = await buildPageMaps(
      pageDump,
      articleIds,
      workIds
    );
    articleIds.clear();
    workIds.clear();

    const charRedirectIds = await fetchCharacterRedirectIds(
      redirectDump,
      workTitleToPageId
    );
    workTitleToPageId.clear();

    const charRedirectTitles = await fetchRedirectTitles(
      pageDump,
      charRedirectIds
    );
    charRedirectIds.clear();

    await writeOutput(artTitles, charRedirectTitles);
    console.log('\nDone.');
  } catch (error) {
    console.error('Fatal:', error);
    process.exit(1);
  }
}
