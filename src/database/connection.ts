import { DatabaseSync } from "node:sqlite";

export const DB_PATH = "data/people.db";

export function openDatabase(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA cache_size=-131072;
    PRAGMA temp_store=MEMORY;
  `);
  return db;
}
