import { DatabaseSync } from 'node:sqlite';

export const CATEGORIES = ['humans', 'fictional', 'apocryphal'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface EntityRow {
  qid: string;
  label: string;
  description: string | null;
  type: string | null;
  category: string;
  sitelink_count: number;
  pageviews: number;
  wikipedia: string | null;
  wikidata: string;
}

export interface SearchParameters {
  q: string;
  category?: Category;
  limit: number;
  offset: number;
}

export interface SearchResponse {
  results: EntityRow[];
  total: number;
  limit: number;
  offset: number;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  rowid          INTEGER PRIMARY KEY,
  qid            TEXT    NOT NULL UNIQUE,
  label          TEXT    NOT NULL,
  description    TEXT,
  type           TEXT,
  category       TEXT    NOT NULL,
  sitelink_count INTEGER NOT NULL DEFAULT 0,
  pageviews      INTEGER NOT NULL DEFAULT 0,
  wikipedia      TEXT,
  wikidata       TEXT    NOT NULL,
  rand           REAL    NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  label, description,
  content='entities', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, label, description)
  VALUES (new.rowid, new.label, new.description);
END;

CREATE INDEX IF NOT EXISTS idx_entities_rand ON entities(category, rand);
`;

export const DB_PATH = process.env.DB_PATH ?? 'data/people.db';

export const database = new DatabaseSync(DB_PATH);
database.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA cache_size=-131072;
  PRAGMA temp_store=MEMORY;
`);
