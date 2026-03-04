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

const preparedQueries = {
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
  categoryCounts: database.prepare(`
    SELECT category, COUNT(*) AS count
    FROM entities
    GROUP BY category
  `),
};

export interface RandomFilters {
  min_sitelinks?: number;
  max_sitelinks?: number;
  min_pageviews?: number;
  max_pageviews?: number;
}

/**
 * Adapted from https://jan.kneschke.de/projects/mysql/order-by-rand/
 */
export function getRandom(category: Category, n: number, filters?: RandomFilters): EntityRow[] {
  const step = 1 / n;
  const offset = Math.random() * step;
  const results: EntityRow[] = [];

  const extraBinds: number[] = [];
  const extraConditions: string[] = [];

  const filterMap: [string, number | undefined][] = [
    ['sitelink_count >= ?', filters?.min_sitelinks],
    ['sitelink_count <= ?', filters?.max_sitelinks],
    ['pageviews >= ?', filters?.min_pageviews],
    ['pageviews <= ?', filters?.max_pageviews],
  ];
  for (const [condition, value] of filterMap) {
    if (value !== undefined) {
      extraConditions.push(condition);
      extraBinds.push(value);
    }
  }

  const stmt = extraConditions.length === 0
    ? preparedQueries.randomSingle
    : database.prepare(`
        SELECT qid, label, description, type, category, sitelink_count, pageviews, wikipedia, wikidata
        FROM entities
        WHERE category = ? AND rand >= ? AND ${extraConditions.join(' AND ')}
        ORDER BY rand
        LIMIT 1
      `);
  const makeArgs = (pivot: number) => [category, pivot, ...extraBinds];

  for (let index = 0; index < n; index++) {
    const pivot = offset + index * step;
    const row =
      stmt.get(...makeArgs(pivot)) ??
      stmt.get(...makeArgs(0));
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
    return preparedQueries.autocomplete
      .all(ftsQuery, limit)
      .map((row) => toEntityRow(row));
  } catch (error) {
    console.error('autocomplete query failed:', ftsQuery, error);
    return [];
  }
}

export function search(
  parameters: SearchParameters,
): SearchResponse | undefined {
  const ftsQuery = buildFtsQuery(parameters.q);
  if (!ftsQuery) return undefined;

  try {
    const {
      limit,
      offset,
      category,
      min_sitelinks,
      max_sitelinks,
      min_pageviews,
      max_pageviews,
    } = parameters;

    const conditions = ['entities_fts MATCH ?'];
    const bindValues: (string | number)[] = [ftsQuery];

    if (category) {
      conditions.push('e.category = ?');
      bindValues.push(category);
    }
    if (min_sitelinks !== undefined) {
      conditions.push('e.sitelink_count >= ?');
      bindValues.push(min_sitelinks);
    }
    if (max_sitelinks !== undefined) {
      conditions.push('e.sitelink_count <= ?');
      bindValues.push(max_sitelinks);
    }
    if (min_pageviews !== undefined) {
      conditions.push('e.pageviews >= ?');
      bindValues.push(min_pageviews);
    }
    if (max_pageviews !== undefined) {
      conditions.push('e.pageviews <= ?');
      bindValues.push(max_pageviews);
    }

    const where = conditions.join(' AND ');
    const base = `FROM entities_fts JOIN entities e ON entities_fts.rowid = e.rowid WHERE ${where}`;

    const results = database
      .prepare(
        `SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.pageviews, e.wikipedia, e.wikidata ${base} ORDER BY e.sitelink_count DESC LIMIT ? OFFSET ?`,
      )
      .all(...bindValues, limit, offset)
      .map((row) => toEntityRow(row));

    const countRow = database
      .prepare(`SELECT COUNT(*) AS total ${base}`)
      .get(...bindValues);

    return { results, total: (countRow?.total as number) ?? 0, limit, offset };
  } catch (error) {
    console.error('search query failed:', ftsQuery, error);
    return undefined;
  }
}

export function getCategoryCounts(): Record<string, number> {
  const rows = preparedQueries.categoryCounts.all();
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.category as string] = row.count as number;
  }
  return counts;
}
