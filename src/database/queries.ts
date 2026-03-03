import type { SQLOutputValue } from 'node:sqlite';
import {
  database,
  type Category,
  type EntityRow,
  type SearchParameters,
  type SearchResponse,
} from './database.js';

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

const stmts = {
  randomSingle: database.prepare(`
    SELECT qid, label, description, type, category, sitelink_count, pageviews, wikipedia, wikidata
    FROM entities
    WHERE category = ? AND rand >= ?
    ORDER BY rand
    LIMIT 1
  `),
  autocomplete: database.prepare(`
    SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.pageviews, e.wikipedia, e.wikidata
    FROM entities_fts
    JOIN entities e ON entities_fts.rowid = e.rowid
    WHERE entities_fts MATCH ?
    ORDER BY e.sitelink_count DESC
    LIMIT ?
  `),
  search: database.prepare(`
    SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.pageviews, e.wikipedia, e.wikidata
    FROM entities_fts
    JOIN entities e ON entities_fts.rowid = e.rowid
    WHERE entities_fts MATCH ?
    ORDER BY e.sitelink_count DESC
    LIMIT ? OFFSET ?
  `),
  searchWithCategory: database.prepare(`
    SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.pageviews, e.wikipedia, e.wikidata
    FROM entities_fts
    JOIN entities e ON entities_fts.rowid = e.rowid
    WHERE entities_fts MATCH ? AND e.category = ?
    ORDER BY e.sitelink_count DESC
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

/**
 * Adapted from https://jan.kneschke.de/projects/mysql/order-by-rand/
 */
export function getRandom(category: Category, n: number): EntityRow[] {
  const step = 1 / n;
  const offset = Math.random() * step;
  const results: EntityRow[] = [];

  for (let index = 0; index < n; index++) {
    const pivot = offset + index * step;
    const row =
      stmts.randomSingle.get(category, pivot) ??
      stmts.randomSingle.get(category, 0);
    if (!row) break;
    results.push(toEntityRow(row as Record<string, SQLOutputValue>));
  }

  for (let index = results.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [results[index], results[swapIndex]] = [results[swapIndex], results[index]];
  }

  return results;
}

export function autocomplete(q: string, limit: number): EntityRow[] {
  const ftsQuery = buildFtsQuery(q);
  if (!ftsQuery) return [];
  try {
    return stmts.autocomplete
      .all(ftsQuery, limit)
      .map((row) => toEntityRow(row));
  } catch (error) {
    console.error('autocomplete query failed:', ftsQuery, error);
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
  } catch (error) {
    console.error('search query failed:', ftsQuery, error);
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