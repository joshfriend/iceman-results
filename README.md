# Iceman Cometh — results explorer

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css`, `js/app.js` | Page and D3 charts (D3 loaded from jsDelivr) |
| `js/stats.js` | Pure stats (passes, groups, podium, KDE, wave stats, next-wave estimate) shared with tests |
| `data/index.json` | **Generated.** Available races and years, newest first, with paths and event-specific counts |
| `scripts/audit_sources.py` | Generates an optional offline source-coverage report at `data/source-audit.json`; the website does not load it |
| `data/<year>/race.json` | Per-year config: date, results URL, wave timing when published, podium depth, optional wave time requirements, raw source paths |
| `data/<year>/raw/` | Source data for that year (RaceResult JSON and start list, Registericeman results, or Athlinks results) |
| `data/<year>/results.json` | **Generated.** Compact rider table the page loads |
| `scripts/build_data.py` | Builds every `data/<year>/results.json` and `data/index.json` |
| `scripts/download_supplemental.py` | Downloads Slush Cup results, separate 2024–2026 pro/junior results, and published 2008/2010 category archives |

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
| `raceEvent` | `iceman`, `junior-iceman`, or `slush-cup`; junior age categories do not by themselves imply entry in the separate junior event |
| `raceGroupSource` | `division`, `resultSet`, `metadata:N`, or `null` when classification is unknown |
| `waveSource`, `startSource` | `results`, `startList`, `metadata:N`, `waveSchedule` (derived from the published schedule), or `null` |

The year recap counts all published entries, treats entries not marked DNS as starters for the
finish rate, and shows finish-time quartiles and median times by published race group. Historical
results without a reliable amateur/pro label remain separate as unclassified.
Its entries-by-year chart uses every available year's published result-row count from
`data/index.json`, not total registrations. Missing years remain gaps; selecting a bar opens
that year's recap, and the selected year is highlighted.
Bars stack finishers with non-finishers (including DNS and DSQ) to total published entries;
historical sources may omit non-finishers, so a fully finished bar does not establish a 100% finish rate.
The year recap is hidden while an individual rider's report is displayed.
Rider history marks years finishing within the published division podium depth (typically the top five).

### Source quality and historical backfills

Historical Athlinks categories are classified using the published category schema, not the
presence of a pro finisher. Missing/ambiguous divisions remain unclassified unless an explicit
course or supplemental source establishes their group. Age alone never establishes a junior
category. Original published category names are preserved when supplemental sources provide them.
Separate junior-event result sets explicitly set `raceEvent: "junior-iceman"` in
`race.json`; otherwise the entered event defaults to `iceman`.
Slush Cup (approximately 8 miles) is available as a separate race selection. Its results are
included in each published year with an available result source, but are excluded from Iceman
standings, recaps, and rider histories. The Sno-Cone is a separate half-mile youth race.

RunMichigan's 2008 and 2010 archives provide **men's category tables only**. Metadata joins require
an exact normalized name, gender, and finish time, plus matching bibs when both sources publish
them. Missing bibs can be recovered; truncated names, mismatches, and absent results are not
guessed. Ambiguous matches, repeated metadata, and conflicting assignments fail the build.
Unmatched archive rows are logged and counted in `race.metadataCoverage` and the source audit.
`race.dataSources` identifies the archived files and supplemental URLs; `metadata:N` refers to
the zero-based entry in its `riderMetadata` array.

The audited Athlinks result rows for 2001–2025 contain no wave/corral/start fields. Registration's
2022–2024 historical result links point back to Athlinks, not additional wave exports. Older
assigned waves still need final start lists or organizer/timer exports; qualifying-time standards,
bib ranges, and finish speeds are not substitutes for actual assignments. Request public results
metadata from the [organizer](https://www.iceman.com/p/about/contact): year, bib, rider name,
gender, finish time, entered event/category, final assigned wave, and scheduled start. No
organizer request is sent by these scripts.

To import an organizer export, normalize its public race fields to a CSV and add an entry to
that year's `race.json`:

```json
"riderMetadata": [
  {
    "format": "csv",
    "path": "raw/official-assignments.csv",
    "sourceUrl": "https://example.com/published-start-list"
  }
]
```

Required CSV headers are `bib,name,gender,net` (`net` is `HH:MM:SS`, blank for nonfinishers;
`bib` may be blank when unavailable). Optional headers are `wave,start,raceGroup,raceEvent,division,divisionRank`.
`start` is `HH:MM:SS`; waves and division ranks are positive integers. Groups are
`amateur`, `junior`, or `pro`; event values are `iceman`, `junior-iceman`, or `slush-cup`.
Every CSV row must match exactly one existing result. A wave without a start can use that year's
published amateur start schedule; absent schedules leave start times unknown. Keep private
registration fields out of archived exports.

## Develop

```sh
npm run download:history # fetch Athlinks results for 2001–2025; preserve primary sources
npm run download:supplemental # fetch Slush Cup, separate pro/junior lists, and category archives
npm run build:data   # after changing raw data
npm run audit:sources # refresh the offline source inventory after rebuilding data
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
