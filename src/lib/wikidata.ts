import ky from "ky";
import { WBK } from "wikibase-sdk";
import type { SimplifiedItem, SparqlResults, EntityId, Entities } from "wikibase-sdk";

const wbk = WBK({
  instance: "https://www.wikidata.org",
  sparqlEndpoint: "https://query.wikidata.org/sparql",
});

const http = ky.create({ headers: { "User-Agent": "WikidataFamousPeopleCollector/1.0(http://github.com/chandlerferry/famous-people)" }, timeout: false });

export interface Result {
  qid: string;
  label: string;
  description: string | null;
  type: string | null;
  sitelinkCount: number;
  wikipedia: string | null;
  wikidata: string;
}

async function sparqlFetch(sparql: string) {
  return wbk.simplify.sparqlResults(await http.get(wbk.sparqlQuery(sparql)).json<SparqlResults>());
}

async function getEntities(qids: string[]): Promise<Map<string, SimplifiedItem>> {
  const results = new Map<string, SimplifiedItem>();
  for (let i = 0; i < qids.length; i += 50) {
    const url = wbk.getEntities({
      ids: qids.slice(i, i + 50) as EntityId[],
      languages: ["en"],
      props: ["descriptions", "sitelinks"],
    });
    try {
      const body = await http.get(url).json<{ entities: Entities }>();
      const simplified = wbk.simplify.entities(body.entities) as Record<string, SimplifiedItem>;
      for (const [qid, entity] of Object.entries(simplified)) results.set(qid, entity);
    } catch (err) {
      console.warn(`Entity batch failed: ${err}`);
    }
  }
  return results;
}

export async function fetchPage(sparql: string): Promise<Result[]> {
  const rows = await sparqlFetch(sparql);
  const qids = [...new Set(rows.map((r) => {
    const item = r.item;
    return typeof item === "object" && item !== null
      ? (item as { value: string }).value
      : item as string;
  }).filter(Boolean))];

  const entities = await getEntities(qids);

  return rows.map((row): Result => {
    const item = row.item;
    const isObj = typeof item === "object" && item !== null;
    const qid = isObj ? (item as { value: string }).value : item as string;
    const label = isObj ? ((item as { label?: string }).label ?? qid) : (row.itemLabel as string ?? qid);
    const entity = entities.get(qid);
    const wikiTitle = entity?.sitelinks?.enwiki ?? null;
    return {
      qid,
      label,
      description: entity?.descriptions?.en ?? null,
      type: (row.type as string) ?? null,
      sitelinkCount: Object.keys(entity?.sitelinks ?? {}).length,
      wikipedia: wikiTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}` : null,
      wikidata: `https://www.wikidata.org/wiki/${qid}`,
    };
  });
}
