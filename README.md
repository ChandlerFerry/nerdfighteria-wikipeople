# nerdfighteria-wikipeople

## Goals of this project
1. Fetch all "People"
    - Famous People
    - Fictional Characters
    - Historial Figures
2. Fetch pageview numbers
3. Sort into popularity based on pageviews
    - Very Famous
    - Kind of Famous
    - Notable
    - Barely Notable
4. If I have time, create some UI

## How many people could I name?
[vlogbrothers Video](https://www.youtube.com/watch?v=6I9eWxP-hQE)


## Updating Data

### 1. Extract entities from Wikidata
1. Download https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz (~12-16 hour download)
2. Place `latest-all.json.gz` in the repository root
3. `pnpm script:extract`
    - extracts people into `data/{humans,fictional,historical}.ndjson`

### 2. Extract pageview data
Pageview counts come from Wikipedia's [monthly complete pageview dumps](https://dumps.wikimedia.org/other/pageview_complete/monthly/) (`pageviews-YYYYMM-user.bz2` files, ~5.5GB each).
1. `pnpm script:pageviews` (takes ~30 hours? guessing, I started it at 12:40 PM on Sunday)
    - downloads all monthly dumps, processes them, writes `data/pageviews.ndjson`

### 3. Import into database
1. `pnpm script:import`
    - reads all NDJSON files, builds `data/people.db`


## Data Insight (Examples to come)

| QID | Category | Type |
|-----|----------|------|
| [Q5](https://www.wikidata.org/wiki/Q5) | humans | - |
| [Q95074](https://www.wikidata.org/wiki/Q95074) | fictional | fictional character |
| [Q15632617](https://www.wikidata.org/wiki/Q15632617) | fictional | fictional human |
| [Q4271324](https://www.wikidata.org/wiki/Q4271324) | fictional | mythical character |
| [Q15773347](https://www.wikidata.org/wiki/Q15773347) | fictional | film character |
| [Q15773317](https://www.wikidata.org/wiki/Q15773317) | fictional | television character |
| [Q3658341](https://www.wikidata.org/wiki/Q3658341) | fictional | literary character |
| [Q50386450](https://www.wikidata.org/wiki/Q50386450) | fictional | operatic character |
| [Q1569167](https://www.wikidata.org/wiki/Q1569167) | fictional | video game character |
| [Q80447738](https://www.wikidata.org/wiki/Q80447738) | fictional | anime character |
| [Q1114461](https://www.wikidata.org/wiki/Q1114461) | fictional | comics character |
| [Q87576284](https://www.wikidata.org/wiki/Q87576284) | fictional | manga character |
| [Q63975020](https://www.wikidata.org/wiki/Q63975020) | fictional | musical theatre character |
| [Q15711870](https://www.wikidata.org/wiki/Q15711870) | fictional | animated character |
| [Q22988604](https://www.wikidata.org/wiki/Q22988604) | fictional | mythological Greek character |
| [Q3375722](https://www.wikidata.org/wiki/Q3375722) | fictional | theatrical character |
| [Q386208](https://www.wikidata.org/wiki/Q386208) | fictional | mascot character |
| [Q20643955](https://www.wikidata.org/wiki/Q20643955) | fictional | human biblical figure |
| [Q28020127](https://www.wikidata.org/wiki/Q28020127) | fictional | fictional humanoid |
| [Q123126876](https://www.wikidata.org/wiki/Q123126876) | fictional | animated television character |
| [Q17624054](https://www.wikidata.org/wiki/Q17624054) | fictional | fictional deity |
| [Q13002315](https://www.wikidata.org/wiki/Q13002315) | fictional | legendary figure |
| [Q108065012](https://www.wikidata.org/wiki/Q108065012) | fictional | radio character |
| [Q25810847](https://www.wikidata.org/wiki/Q25810847) | fictional | folklore character |
| [Q21070568](https://www.wikidata.org/wiki/Q21070568) | historical | - |
