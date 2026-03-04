# Nerdfighteria-WikiPeople

This project builds a dataset of ~11.7 million people extracted from [Wikidata](https://www.wikidata.org/).
Each entity is enriched with English Wikipedia pageview counts and classified into popularity tiers based on aggregate traffic.

### Inspiration

This project was inspired by the vlogbrothers ["Can We Do a Science Together??"](https://www.youtube.com/watch?v=6I9eWxP-hQE), which poses the question of how many people an individual can recall.

## Entity Categories

Entities are classified using Wikidata's [instance of (P31)](https://www.wikidata.org/wiki/Property:P31) property into three top-level categories:

| Category | Description | Entity Count |
|----------|-------------|-------------:|
| [Humans](https://www.wikidata.org/wiki/Q5) | Real people | 11,593,234 |
| Fictional | Characters from literature, film, mythology, etc. [(full breakdown)](docs/fictional-characters.md)  | 91,282 |
| [Apocryphal](https://www.wikidata.org/wiki/Q21070568) | Historically disputed figures | 864 |

## Data Pipeline

Reproducing the dataset requires running three sequential stages. Each stage is long-running due to the size of the source data.

Otherwise, [download people.db from MEGA](https://mega.nz/file/c8g0TZzD#lxgL7y29XxPBpSMS86XDMjosTAsXyQqJbSq25B_y6nA) and place it at `data/people.db`

### Stage 1: Extract Entities from Wikidata (~1 day?)

1. Download the complete Wikidata JSON dump (~100 GB compressed):
   https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz
2. Place `latest-all.json.gz` in the repository root.
3. Run the extraction script:
   ```bash
   pnpm script:extract-wikidata
   ```
   This produces `data/humans.ndjson`, `data/fictional.ndjson`, and `data/apocryphal.ndjson`.

   The demo is usable at this point, but it will not contain pageview data.

### Stage 2: Extract Pageview Data (~5 days?)

Pageview counts are sourced from Wikipedia's [monthly complete pageview dumps](https://dumps.wikimedia.org/other/pageview_complete/monthly/) (`pageviews-YYYYMM-user.bz2`, ~5.5 GB each).

```bash
pnpm script:extract-pageviews
```

This downloads all monthly dump files, processes them, and writes `data/pageviews.ndjson`. Expect this stage to take approximately 30 hours depending on network and disk speed.

### Stage 3: Build the Database

```bash
pnpm script:build-database
```

This reads all NDJSON files and produces the SQLite database at `data/people.db`.

## API

Once the database is built, start the API server:

```bash
pnpm build && pnpm serve
```

The server listens on port 8080. Rate limiting (100 requests/minute per IP) applies to the data endpoints.

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (no rate limit) |
| `GET /random?n=50` | Random sample of N entities per category |
| `GET /autocomplete?q=einst&limit=10` | FTS5 prefix-based autocomplete |
| `GET /search?q=einstein&category=humans&limit=20&offset=0` | Full-text search with BM25 ranking and pagination. Optional filters: `min_sitelinks`, `max_sitelinks`, `min_pageviews`, `max_pageviews` |

## Known Limitations

- **English-only scope.** Entities without an English Wikidata label are dropped during extraction. Pageview counts also reflect English Wikipedia traffic only.
- **Silent filtering.** Malformed data in the Wikidata dump are skipped.
- **Redirect-only characters.** Fictional characters that exist only as Wikipedia redirects (e.g., [Hazel Grace Lancaster](https://en.wikipedia.org/wiki/Hazel_Grace_Lancaster)) are not captured, as they lack a standalone Wikidata entity.
- **P31-only classification.** Entities are matched against a hardcoded allowlist of [P31](https://www.wikidata.org/wiki/Property:P31) QIDs with no [P279](https://www.wikidata.org/wiki/Property:P279) subclass traversal.
  - **Fictional animals.** [Q3542731](https://www.wikidata.org/wiki/Q3542731), [Q30017383](https://www.wikidata.org/wiki/Q30017383) not in allowlist.
  - **Franchise-specific types.** e.g. [Pikachu (Q9351)](https://www.wikidata.org/wiki/Q9351) has `P31 =` [Q25930719](https://www.wikidata.org/wiki/Q25930719) (deep in subclass hierarchy).
  - **Profession-based subtypes.** e.g. [fictional detective (Q3656924)](https://www.wikidata.org/wiki/Q3656924) are only captured if also tagged with a generic fictional type.
  - **Mythology.** [Greek (Q22988604)](https://www.wikidata.org/wiki/Q22988604) is allowlisted, but other mythologies may be missed.
