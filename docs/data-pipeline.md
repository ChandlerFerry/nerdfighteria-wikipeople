# Data Pipeline

Reproducing the dataset from scratch requires three sequential stages. Each stage is long-running due to the size of the source data.

## Stage 1: Extract Entities from Wikidata (~1 day?)

1. Download the complete Wikidata JSON dump (~100 GB compressed):
   https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz
2. Place `latest-all.json.gz` in the repository root.
3. Run the extraction script:
   ```bash
   pnpm script:extract-wikidata
   ```
   This produces `data/humans.ndjson`, `data/fictional.ndjson`, and `data/apocryphal.ndjson`.

   The demo is usable at this point, but it will not contain pageview data.

## Stage 2: Extract Pageview Data (~5 days?)

Pageview counts are sourced from Wikipedia's [monthly complete pageview dumps](https://dumps.wikimedia.org/other/pageview_complete/monthly/) (`pageviews-YYYYMM-user.bz2`, ~5.5 GB each).

```bash
pnpm script:extract-pageviews
```

This downloads all monthly dump files, processes them, and writes `data/pageviews.ndjson`. Expect this stage to take approximately 30 hours depending on network and disk speed.

## Stage 3: Build the Database

```bash
pnpm script:build-database
```

This reads all NDJSON files and produces the SQLite database at `data/people.db`.
