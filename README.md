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


## Data Insight

~11.6M entities across 3 categories extracted from Wikidata.

| QID | Category | Type | Count |
|-----|----------|------|------:|
| [Q5](https://www.wikidata.org/wiki/Q5) | humans | - | 11,593,234 |
| [Q95074](https://www.wikidata.org/wiki/Q95074) | fictional | fictional character | 3,244 |
| [Q15632617](https://www.wikidata.org/wiki/Q15632617) | fictional | fictional human | 43,829 |
| [Q4271324](https://www.wikidata.org/wiki/Q4271324) | fictional | mythical character | 917 |
| [Q15773347](https://www.wikidata.org/wiki/Q15773347) | fictional | film character | 1,991 |
| [Q15773317](https://www.wikidata.org/wiki/Q15773317) | fictional | television character | 2,553 |
| [Q3658341](https://www.wikidata.org/wiki/Q3658341) | fictional | literary character | 4,009 |
| [Q50386450](https://www.wikidata.org/wiki/Q50386450) | fictional | operatic character | 7,855 |
| [Q1569167](https://www.wikidata.org/wiki/Q1569167) | fictional | video game character | 3,479 |
| [Q80447738](https://www.wikidata.org/wiki/Q80447738) | fictional | anime character | 817 |
| [Q1114461](https://www.wikidata.org/wiki/Q1114461) | fictional | comics character | 5,019 |
| [Q87576284](https://www.wikidata.org/wiki/Q87576284) | fictional | manga character | 1,033 |
| [Q63975020](https://www.wikidata.org/wiki/Q63975020) | fictional | musical theatre character | 90 |
| [Q15711870](https://www.wikidata.org/wiki/Q15711870) | fictional | animated character | 3,347 |
| [Q22988604](https://www.wikidata.org/wiki/Q22988604) | fictional | mythological Greek character | 5,195 |
| [Q3375722](https://www.wikidata.org/wiki/Q3375722) | fictional | theatrical character | 2,641 |
| [Q386208](https://www.wikidata.org/wiki/Q386208) | fictional | mascot character | 914 |
| [Q20643955](https://www.wikidata.org/wiki/Q20643955) | fictional | human biblical figure | 1,411 |
| [Q28020127](https://www.wikidata.org/wiki/Q28020127) | fictional | fictional humanoid | 957 |
| [Q123126876](https://www.wikidata.org/wiki/Q123126876) | fictional | animated television character | 777 |
| [Q17624054](https://www.wikidata.org/wiki/Q17624054) | fictional | fictional deity | 565 |
| [Q13002315](https://www.wikidata.org/wiki/Q13002315) | fictional | legendary figure | 447 |
| [Q108065012](https://www.wikidata.org/wiki/Q108065012) | fictional | radio character | 20 |
| [Q25810847](https://www.wikidata.org/wiki/Q25810847) | fictional | folklore character | 172 |
| [Q21070568](https://www.wikidata.org/wiki/Q21070568) | historical | - | 864 |
