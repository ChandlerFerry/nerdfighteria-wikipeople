import { describe, it, expect } from 'vitest';
import {
  database,
  CATEGORIES,
  type Category,
} from '../src/database/database.js';
import {
  getRandom,
  autocomplete,
  search,
  getCategoryCounts,
} from '../src/database/queries.js';

describe('database validation', () => {
  const counts = getCategoryCounts();

  it('the database has over 11 million entities', () => {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(11_000_000);
  });

  it('humans is the largest category', () => {
    expect(counts.humans).toBeGreaterThan(counts.fictional);
    expect(counts.humans).toBeGreaterThan(counts.apocryphal);
  });

  it('all three categories exist (humans, fictional, apocryphal)', () => {
    for (const category of CATEGORIES) {
      expect(counts[category]).toBeGreaterThan(0);
    }
  });

  it('Albert Einstein (Q937) exists and is a human', () => {
    const result = database
      .prepare('SELECT * FROM entities WHERE qid = ?')
      .get('Q937') as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.label).toBe('Albert Einstein');
    expect(result!.category).toBe('humans');
  });

  it('Sherlock Holmes (Q4653) exists and is fictional', () => {
    const result = database
      .prepare('SELECT * FROM entities WHERE qid = ?')
      .get('Q4653') as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.label).toBe('Sherlock Holmes');
    expect(result!.category).toBe('fictional');
  });

  it('every entity has a qid and label', () => {
    const missing = database
      .prepare(
        `SELECT COUNT(*) AS count FROM entities
         WHERE qid IS NULL OR qid = ''
            OR label IS NULL OR label = ''`
      )
      .get() as { count: number };
    expect(missing.count).toBe(0);
  });

  it('search for "einstein" returns Albert Einstein in the top results', () => {
    const result = search({ q: 'einstein', limit: 10, offset: 0 });
    expect(result).toBeDefined();
    expect(result!.results.length).toBeGreaterThan(0);
    const qids = result!.results.map((r) => r.qid);
    expect(qids).toContain('Q937');
  });

  it('autocomplete for "einst" returns results', () => {
    const results = autocomplete('einst', 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it('random returns the requested number of items per category', () => {
    const n = 5;
    for (const category of CATEGORIES) {
      const results = getRandom(category as Category, n);
      expect(results.length).toBe(n);
    }
  });

  it('no entity has an empty label', () => {
    const empty = database
      .prepare(
        `SELECT COUNT(*) AS count FROM entities WHERE TRIM(label) = ''`
      )
      .get() as { count: number };
    expect(empty.count).toBe(0);
  });
});
