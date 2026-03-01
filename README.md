# nerdfighteria-wikipeople

## Goals of this project
1. Fetch all "People"
    - Famous People
    - Fictional Characters
    - Historial Figures
2. Fetch pageview numbers
3. Sort into categories based on pageviews
    - Very Famous
    - Kind of Famous
    - Notable
    - Barely Notable
4. If I have time, create the UI

## How many people could I name?
[vlogbrothers Video](https://www.youtube.com/watch?v=6I9eWxP-hQE)


## Updating Data
1. Download https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz (~12-16 hour download, triple that if you forget and turn off your computer while you sleep)
2. Place `latest-all.json.gz` in this repository's root next to the `src` folder
3. Run `pnpm i` -> `pnpm build` -> `pnpm start` -> `pnpm merge`


## Data Insight (Examples to come)

| QID | Category | Type | Wikidata |
|-----|----------|------|----------|
| [Q5](https://www.wikidata.org/wiki/Q5) | humans | — | human |
| [Q95074](https://www.wikidata.org/wiki/Q95074) | fictional | fictional character | fictional character |
| [Q15632617](https://www.wikidata.org/wiki/Q15632617) | fictional | fictional human | fictional human |
| [Q4271324](https://www.wikidata.org/wiki/Q4271324) | fictional | mythical character | mythical character |
| [Q15773347](https://www.wikidata.org/wiki/Q15773347) | fictional | fictional organism | fictional organism |
| [Q15773317](https://www.wikidata.org/wiki/Q15773317) | fictional | television character | television character |
| [Q3658341](https://www.wikidata.org/wiki/Q3658341) | fictional | literary character | literary character |
| [Q21070568](https://www.wikidata.org/wiki/Q21070568) | historical | — | human who may be fictional |
