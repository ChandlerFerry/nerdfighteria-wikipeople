# famous-people

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


## Usage
1. Download https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz (~12-16 hour download, triple that if you forget and turn off your computer while you sleep)
2. Place `latest-all.json.gz` in this repository's root next to the `src` folder
3. Run `pnpm i` -> `pnpm build` -> `pnpm start` -> `pnpm merge`


## Data Insight
```
Q5:        { category: "humans",     type: null },
Q95074:    { category: "fictional",  type: "fictional character" },
Q15632617: { category: "fictional",  type: "fictional human" },
Q21070568: { category: "historical", type: null },
```
- Included: `Miles Edward O'Brien (Star Trek)`
- Included: `Confucius`
- Included: `Chandler Bing`
- Included: `Hank Green`
- Not Included: `John Jacob Jingleheimer Schmidt`
