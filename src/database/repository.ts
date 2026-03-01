import { DatabaseSync, StatementSync, type SQLOutputValue } from "node:sqlite";
import type { Category, EntityRow, SearchParams as SearchParameters, SearchResponse } from "./types.js";

interface Statements {
  randomByCategory: StatementSync;
  randomByCategoryFrom0: StatementSync;
  autocomplete: StatementSync;
  search: StatementSync;
  searchWithCategory: StatementSync;
  searchCount: StatementSync;
  searchCountWithCategory: StatementSync;
}

function buildFtsQuery(raw: string): string | undefined {
  const tokens = raw.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  return tokens.map((t) => `${t}*`).join(" ");
}

function toEntityRow(row: Record<string, SQLOutputValue>): EntityRow {
  return {
    qid: row.qid as string,
    label: row.label as string,
    description: row.description as string | null,
    type: row.type as string | null,
    category: row.category as string,
    sitelink_count: row.sitelink_count as number,
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

export class EntityRepository {
  private readonly stmts: Statements;

  constructor(private readonly database: DatabaseSync) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements(): Statements {
    return {
      randomByCategory: this.db.prepare(`
        SELECT qid, label, description, type, category, sitelink_count, wikipedia, wikidata
        FROM entities
        WHERE category = ? AND rand >= ?
        ORDER BY rand
        LIMIT ?
      `),
      randomByCategoryFrom0: this.db.prepare(`
        SELECT qid, label, description, type, category, sitelink_count, wikipedia, wikidata
        FROM entities
        WHERE category = ? AND rand >= 0
        ORDER BY rand
        LIMIT ?
      `),
      autocomplete: this.db.prepare(`
        SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.wikipedia, e.wikidata
        FROM entities_fts
        JOIN entities e ON entities_fts.rowid = e.rowid
        WHERE entities_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `),
      search: this.db.prepare(`
        SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.wikipedia, e.wikidata
        FROM entities_fts
        JOIN entities e ON entities_fts.rowid = e.rowid
        WHERE entities_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `),
      searchWithCategory: this.db.prepare(`
        SELECT e.qid, e.label, e.description, e.type, e.category, e.sitelink_count, e.wikipedia, e.wikidata
        FROM entities_fts
        JOIN entities e ON entities_fts.rowid = e.rowid
        WHERE entities_fts MATCH ? AND e.category = ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `),
      searchCount: this.db.prepare(`
        SELECT COUNT(*) AS total
        FROM entities_fts
        JOIN entities e ON entities_fts.rowid = e.rowid
        WHERE entities_fts MATCH ?
      `),
      searchCountWithCategory: this.db.prepare(`
        SELECT COUNT(*) AS total
        FROM entities_fts
        JOIN entities e ON entities_fts.rowid = e.rowid
        WHERE entities_fts MATCH ? AND e.category = ?
      `),
    };
  }

  getRandom(category: Category, n: number): EntityRow[] {
    const pivot = Math.random();
    const first = this.stmts.randomByCategory.all(category, pivot, n).map((row) => toEntityRow(row));

    if (first.length >= n) return shuffle(first);

    const rest = this.stmts.randomByCategoryFrom0
      .all(category, n - first.length)
      .map((row) => toEntityRow(row));

    return shuffle([...first, ...rest]);
  }

  autocomplete(q: string, limit: number): EntityRow[] {
    const ftsQuery = buildFtsQuery(q);
    if (!ftsQuery) return [];
    try {
      return this.stmts.autocomplete.all(ftsQuery, limit).map((row) => toEntityRow(row));
    } catch {
      return [];
    }
  }

  // Returns undefined when the query sanitizes to nothing — callers should respond with 400.
  search(parameters: SearchParameters): SearchResponse | undefined {
    const ftsQuery = buildFtsQuery(parameters.q);
    if (!ftsQuery) return undefined;

    try {
      const { limit, offset, category } = parameters;

      const results = category
        ? this.stmts.searchWithCategory.all(ftsQuery, category, limit, offset).map((row) => toEntityRow(row))
        : this.stmts.search.all(ftsQuery, limit, offset).map((row) => toEntityRow(row));

      const countRow = category
        ? this.stmts.searchCountWithCategory.get(ftsQuery, category)
        : this.stmts.searchCount.get(ftsQuery);

      return { results, total: (countRow?.total as number) ?? 0, limit, offset };
    } catch {
      return undefined;
    }
  }

  close(): void {
    this.db.close();
  }
}
