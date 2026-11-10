# Iceman Cometh — results explorer

Static GitHub Pages site. Enter a bib number (or name) to see:

- **You passed / Passed you / Net**: estimated from results. You passed a rider if they
  started at the same time as you or earlier and finished after you on the clock. A rider passed
  you if they started at the same time as you or later and finished before you. Clock finish =
  scheduled wave start + official net time. These counts leave out DNFs and repeated passes.
- **Division podium** (top 5): a trophy colored gold/silver/bronze for 1st–3rd, blue for 4th–5th;
  otherwise the time behind the division's last podium place ("Behind podium").
- **Finish-time bell curves** (KDE + histogram) for overall, gender, division and the rider's start wave,
  shaded faster/slower than the rider, with official places.
- **Box plot by wave**: median ± 1 SD box, fastest–slowest range, every finisher as a dot,
  and the rider's wave and time highlighted.

Looking up a rider puts it in the URL (`?year=2026&bib=4026`) so the address bar, or the **Copy link** button, can be shared. Name searches resolve to the bib. Links without `year` use the latest year.

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css`, `js/app.js` | Page and D3 charts (D3 loaded from jsDelivr) |
| `js/stats.js` | Pure stats (passes, groups, podium, KDE, wave stats) shared with tests |
| `data/index.json` | **Generated.** Years available, newest first, with paths and counts |
| `data/<year>/race.json` | Hand-written per-year config: date, results URL, first wave start, wave spacing, podium depth, raw source paths |
| `data/<year>/raw/` | Untouched sources for that year (RaceResult overall-results JSON, start list as text) |
| `data/<year>/results.json` | **Generated.** Compact rider table the page loads |
| `scripts/build_data.py` | Builds every `data/<year>/results.json` and `data/index.json` |

### Data format

`results.json` is `{race, fields, riders}`. `race` holds the year's settings (name, year, date,
`firstStart` and `waveSeconds` in seconds, `podiumDepth`). `riders` is an array of rows in `fields` order:

| Field | Meaning |
|---|---|
| `bib` | Bib number for that year only |
| `person` | Year-independent key (slugged name) for matching a rider across years |
| `name`, `city` | As published |
| `status` | Overall place (number) or `DNF` / `DNS` / `DSQ` |
| `net` | Official net time in seconds, `null` if none |
| `gender`, `genderRank` | `M`/`F` and gender place |
| `division`, `divisionRank` | Division name and place |
| `start`, `wave` | Scheduled start (seconds after midnight) and wave number |

### Adding a year

1. Create `data/<year>/race.json` (copy 2026's) and drop that year's files in `data/<year>/raw/`.
   If the source format changed, add a parser in `build_data.py` and point `sources` at it.
2. `npm run build:data && npm test`.

For future cross-year comparisons, match riders across years by `person` (bibs are reassigned each year).
Names aren't unique (20 repeated names in 2026), so use `city` as a tie-breaker and treat a
match as likely, not certain. Division names change with age, so compare a person's own times
and places across years rather than division-to-division.

## Develop

```sh
npm run build:data   # after changing raw data
npm test             # Node's built-in test runner, no dependencies
npm run serve        # http://localhost:8000/?bib=4026
```

## Publish

```sh
gh repo create iceman-results --public --source . --push
gh api -X POST repos/{owner}/iceman-results/pages -f 'source[branch]=main' -f 'source[path]=/'
```

Or in the repo on GitHub: **Settings → Pages → Deploy from a branch → `main` / root**.
