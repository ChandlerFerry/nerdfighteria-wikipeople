export const humans = (limit: number, offset: number) => `
SELECT ?item ?itemLabel WHERE {
  ?item wdt:P31 wd:Q5.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}
OFFSET ${offset}
`;

export const fictional = (limit: number, offset: number) => `
SELECT ?item ?itemLabel ?type WHERE {
  {
    ?item wdt:P31 wd:Q95074.
    BIND("fictional character" AS ?type)
  } UNION {
    ?item wdt:P31 wd:Q15632617.
    BIND("fictional human" AS ?type)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}
OFFSET ${offset}
`;

export const historical = (limit: number, offset: number) => `
SELECT ?item ?itemLabel WHERE {
  ?item wdt:P31 wd:Q21070568.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}
OFFSET ${offset}
`;
