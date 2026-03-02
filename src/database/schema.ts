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
  wikidata       TEXT,
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

CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);
CREATE INDEX IF NOT EXISTS idx_entities_rand ON entities(category, rand);
CREATE INDEX IF NOT EXISTS idx_entities_wikipedia ON entities(wikipedia);
`;
