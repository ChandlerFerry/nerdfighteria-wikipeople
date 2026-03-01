export const CATEGORIES = ["humans", "fictional", "historical"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface EntityRow {
  qid: string;
  label: string;
  description: string | null;
  type: string | null;
  category: string;
  sitelink_count: number;
  wikipedia: string | null;
  wikidata: string;
}

export interface SearchParams {
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
