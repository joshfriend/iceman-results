# Iceman Cometh — results explorer

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css`, `js/app.js` | Page and D3 charts (D3 loaded from jsDelivr) |
| `js/stats.js` | Pure stats (passes, groups, podium, KDE, wave stats, next-wave estimate) shared with tests |
| `data/index.json` | **Generated.** Years available, newest first, with paths and counts |
| `data/<year>/race.json` | Per-year config: date, results URL, wave timing when published, podium depth, optional wave time requirements, raw source paths |
| `data/<year>/raw/` | Source data for that year (RaceResult JSON and start list, Registericeman results, or Athlinks results) |
| `data/<year>/results.json` | **Generated.** Compact rider table the page loads |
| `scripts/build_data.py` | Builds every `data/<year>/results.json` and `data/index.json` |
| `scripts/download_supplemental.py` | Downloads the separately published 2024 pro and 2025–2026 junior/pro results |

### Data format

`results.json` is `{race, fields, riders}`. `race` holds the year's settings (name, year, date,
`firstStart` and `waveSeconds` in seconds, `podiumDepth`). `riders` is an array of rows in `fields` order:

| Field | Meaning |
|---|---|
| `bib` | Bib number for that year only |
| `person` | Year-independent key (slugged name) for matching a rider across years |
| `athlinksRacerId` | Athlinks rider ID when nonzero; otherwise `null` |
| `age` | Published age when valid and available; otherwise `null` |
| `name`, `city` | As published |
| `status` | Published overall place (number) or `DNF` / `DNS` / `DSQ`; intermediate-only results are `DNF` |
| `net` | Complete-course time in seconds, `null` for non-finishers |
| `gender`, `genderRank` | `M`/`F` and gender place |
| `division`, `divisionRank` | Division name and place |
| `start`, `wave` | Scheduled start (seconds after midnight) and wave number |
| `raceGroup` | `amateur`, `junior`, `pro` (including Pro/Cat 1), or `unclassified` when historical pro labels are unavailable |

## Develop

```sh
npm run download:history # fetch Athlinks results for 2001–2025; preserve primary sources
npm run download:supplemental # fetch separate long-course pro/junior lists
npm run build:data   # after changing raw data
npm test             # Node's built-in test runner, no dependencies
python3 -m unittest discover -s tests -p 'test_*.py' # builder and downloader tests
npm run serve        # http://localhost:8000/?bib=4026
```

## Publish

The site is hosted on GitHub Pages at https://iceman.fueledbycaffeine.com.
Configure Pages to deploy from `main` / root, with the custom domain
`iceman.fueledbycaffeine.com` and HTTPS enforced. The root `CNAME` file preserves
the domain across deployments.

DNS: `iceman.fueledbycaffeine.com` is a CNAME pointing to `joshfriend.github.io`.
Push changes to `main` to publish updates.
