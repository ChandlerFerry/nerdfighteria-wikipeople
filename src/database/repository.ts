import type { SQLOutputValue } from 'node:sqlite';
import { openDatabase } from './connection.js';
import type {
  Category,
  EntityRow,
  SearchParameters,
  SearchResponse,
} from './types.js';

function buildFtsQuery(raw: string): string | undefined {
  const tokens = raw.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  return tokens.map((t) => `${t}*`).join(' ');
}

function toEntityRow(row: Record<string, SQLOutputValue>): EntityRow {
  return {
    qid: row.qid as string,
    label: row.label as string,
    description: row.description as string | null,
    type: row.type as string | null,
    category: row.category as string,
    sitelink_count: row.sitelink_count as number,
    pageviews: row.pageviews as number,
    wikipedia: row.wikipedia as string | null,
    wikidata: row.wikidata as string,
  };
}

function shuffle<T>(array: T[]): T[] {
  for (let index = array.length - 1; index > 0; index--) {
    const index_ = Math.floor(Math.random() * (index + 1));
    [array[index], array[index_]] = [array[index_], array[index]];
  }
  return array;
}

const database = openDatabase();

const stmts = {
  randomByCategory: database.prepare(`
    SELECT qid, label, description, type, category, sitelink_count, pageviews, wikipedia, wikidata
    FROM entities
    WHERE category = ? AND rand >= ?
    ORDER BY rand
    LIMIT ?
  `),
  randomByCategoryFrom0: database.prepare(`
    SELECT qid, label, description, type, category, sitelink_count, pageviews, wikipedia, wikidata
    FROM entities
    WHERE category = ? AND rand >= 0
    ORDER BY rand
    LIMIT ?
  `),
  autocomplete: database.prepare(`
    SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.pageviews, e.wikipedia, e.wikidata
    FROM entities_fts
    JOIN entities e ON entities_fts.rowid = e.rowid
    WHERE entities_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `),
  search: database.prepare(`
    SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.pageviews, e.wikipedia, e.wikidata
    FROM entities_fts
    JOIN entities e ON entities_fts.rowid = e.rowid
    WHERE entities_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `),
  searchWithCategory: database.prepare(`
    SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.pageviews, e.wikipedia, e.wikidata
    FROM entities_fts
    JOIN entities e ON entities_fts.rowid = e.rowid
    WHERE entities_fts MATCH ? AND e.category = ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `),
  searchCount: database.prepare(`
    SELECT COUNT(*) AS total
    FROM entities_fts
    JOIN entities e ON entities_fts.rowid = e.rowid
    WHERE entities_fts MATCH ?
  `),
  searchCountWithCategory: database.prepare(`
    SELECT COUNT(*) AS total
    FROM entities_fts
    JOIN entities e ON entities_fts.rowid = e.rowid
    WHERE entities_fts MATCH ? AND e.category = ?
  `),
  categoryCounts: database.prepare(`
    SELECT category, COUNT(*) AS count
    FROM entities
    GROUP BY category
  `),
};

export function getRandom(category: Category, n: number): EntityRow[] {
  const pivot = Math.random();
  const first = stmts.randomByCategory
    .all(category, pivot, n)
    .map((row) => toEntityRow(row));

  if (first.length >= n) return shuffle(first);

  const rest = stmts.randomByCategoryFrom0
    .all(category, n - first.length)
    .map((row) => toEntityRow(row));

  return shuffle([...first, ...rest]);
}

export function autocomplete(q: string, limit: number): EntityRow[] {
  const ftsQuery = buildFtsQuery(q);
  if (!ftsQuery) return [];
  try {
    return stmts.autocomplete
      .all(ftsQuery, limit)
      .map((row) => toEntityRow(row));
  } catch {
    return [];
  }
}

export function search(
  parameters: SearchParameters
): SearchResponse | undefined {
  const ftsQuery = buildFtsQuery(parameters.q);
  if (!ftsQuery) return undefined;

  try {
    const { limit, offset, category } = parameters;

    const results = category
      ? stmts.searchWithCategory
          .all(ftsQuery, category, limit, offset)
          .map((row) => toEntityRow(row))
      : stmts.search
          .all(ftsQuery, limit, offset)
          .map((row) => toEntityRow(row));

    const countRow = category
      ? stmts.searchCountWithCategory.get(ftsQuery, category)
      : stmts.searchCount.get(ftsQuery);

    return { results, total: (countRow?.total as number) ?? 0, limit, offset };
  } catch {
    return undefined;
  }
}

export function getCategoryCounts(): Record<string, number> {
  const rows = stmts.categoryCounts.all();
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.category as string] = row.count as number;
  }
  return counts;
}

export function close(): void {
  database.close();
}
