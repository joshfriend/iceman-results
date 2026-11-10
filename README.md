# Iceman Cometh — results explorer

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css`, `js/app.js` | Page and D3 charts (D3 loaded from jsDelivr) |
| `js/stats.js` | Pure stats (passes, groups, podium, KDE, wave stats, next-wave estimate) shared with tests |
| `data/index.json` | **Generated.** Available races and years, newest first, with paths and event-specific counts |
| `scripts/audit_sources.py` | Generates an optional offline source-coverage report at `data/source-audit.json`; the website does not load it |
| `data/<year>/race.json` | Per-year config: date, results URL, wave timing when published, podium depth, optional wave time requirements and wave assignments, raw source paths |
| `data/<year>/raw/` | Source data for that year (RaceResult JSON and start list, Registericeman results, or Athlinks results) |
| `data/<year>/results.json` | **Generated.** Compact rider table the page loads |
| `scripts/build_data.py` | Builds every `data/<year>/results.json` and `data/index.json` |
| `data/<year>/raw/wave-placements.json` | Historical wave placement source data, when available |
| `data/<year>/raw/wave-schedule.json` | Transcribed organizer schedules with Wayback snapshot provenance in `race.json` |
| `scripts/download_wave_placements.py` | Downloads 2021–2024 historical wave placements and stores them as JSON |
| `scripts/download_splits.py` | Archives bulk checkpoint reports without fetching individual certificates |
| `data/splits.json` | Offline split-source inventory by year; empty sources mean no intermediate splits were exposed by the archived providers |
| `data/<year>/raw/*splits*.json.gz` | Gzip-compressed JSON split reports with original source responses |
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
| `waveSource`, `startSource` | `results`, `startList`, `metadata:N`, `waveSchedule` (published schedule), `bsnyd` (historical wave placement), or `null` |

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

### Archived wave schedules

Wayback schedules are incorporated for 2008, 2010, 2014, 2016, 2018, and 2019.
Each year's `waveSchedule` records the snapshot URL and normalized JSON path.
Its `starts` maps event IDs to wave/start tables, `divisionWaves` matches exact
published division labels, and `waveAssignments` supplies group/gender starts.
Provenance is retained in generated `race.dataSources.waveSchedule`.

The 2008 schedule matches recovered RunMichigan skill categories; waves 1-6 lack
published start times. The 2010 schedule mixes seeded and age-based waves, so age
alone cannot establish assignment. Other recovered assignments are pro-only.
Pro men and women share a wave in 2008/2010 but start 30 seconds apart.
Missing gender can use an exact published pro division without changing gender.
Junior age categories do not establish MYC entry; event schedules stay separate.
Published irregularities (2014 waves 18/19 and 2010 wave 35) are retained.
Early-season 2015/2017 captures are not treated as verified race-day schedules.

## Develop

```sh
npm run download:history # fetch Athlinks results for 2001–2025; preserve primary sources
npm run download:supplemental # fetch Slush Cup, separate pro/junior lists, and category archives
npm run download:splits # archive all available years' published split reports
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
