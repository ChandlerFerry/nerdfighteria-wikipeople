import { DatabaseSync } from "node:sqlite";

export const DB_PATH = "data/people.db";

export function openDatabase(): DatabaseSync {
  const database = new DatabaseSync(DB_PATH);
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA cache_size=-131072;
    PRAGMA temp_store=MEMORY;
  `);
  return database;
}
