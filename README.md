# Iceman Cometh — results explorer

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css`, `js/app.js` | Page and D3 charts (D3 loaded from jsDelivr) |
| `js/stats.js` | Pure stats (passes, groups, podium, KDE, wave stats, next-wave estimate) shared with tests |
| `data/index.json` | **Generated.** Available races and years, newest first, with paths, event-specific counts, and Iceman yearly winner time/speed and course-distance summaries |
| `scripts/audit_sources.py` | Generates an optional offline source-coverage report at `data/source-audit.json`; the website does not load it |
| `data/<year>/race.json` | Per-year config: date, results URL, wave timing when published, podium depth, optional wave time requirements and wave assignments, raw source paths and attribution |
| `data/<year>/raw/` | Source data for that year (RaceResult JSON and start list, Registericeman results, or Athlinks results) |
| `data/<year>/results.json` | **Generated.** Compact rider table the page loads |
| `scripts/build_data.py` | Builds every `data/<year>/results.json`, `data/<year>/splits.json`, and `data/index.json` |
| `data/<year>/raw/wave-placements.json` | Historical wave placement source data, when available |
| `data/<year>/raw/pass-counts.csv` | Archived 2021–2023 pass-count spreadsheet exports; source URLs and credits are recorded in `race.json` |
| `data/<year>/raw/wave-schedule.json` | Transcribed organizer schedules with Wayback snapshot provenance in `race.json` |
| `scripts/download_wave_placements.py` | Downloads 2021–2024 historical wave placements and stores them as JSON |
| `scripts/download_splits.py` | Archives bulk checkpoint reports without fetching individual certificates |
| `data/splits.json` | Offline split-source inventory by year; empty sources mean no intermediate splits were exposed by the archived providers |
| `data/<year>/raw/*splits*.json.gz` | Gzip-compressed JSON split reports with original source responses |
| `scripts/download_supplemental.py` | Downloads Slush Cup results, separate 2024–2026 pro/junior results, and published 2008/2010 category archives |

### Data format

Per-year `race.json` may include `splitLocations`, mapping published split labels
to known checkpoint locations without changing the raw source data. For 2025,
`8.4 Mile` is Dockery Rd and `16.6 Mile` is North Broomhead Rd.
The rider page shows these names in its checkpoint splits table.

`data/<year>/splits.json` is **generated** from the archived split reports listed in `data/splits.json`
(years without published checkpoints have none, and `index.json` links to those that exist). It is
`{courses: [{checkpoints: [{name, miles, location}], riders: {bib: [elapsed seconds per checkpoint]}}]}`;
`miles` is cumulative and `null` when no distance is known (a missed checkpoint's time is `null`).
RaceResult publishes no 2026 checkpoint distances, so `race.json` records `splitDistances`: the GPS distance
from the gun to each timing mat in a rider's 2026 Garmin activity (the 2025 course file doesn't match the 2026
route). The build keeps those fractions of the course and scales them to the distance implied by the year's
published speeds, marking the course `estimated` with a `finishMiles` for riders without their own course distance. Readings that break the checkpoint order are dropped. The rider page adds a finish row from
the official time and `courseDistance`, and computes leg times and speeds between timed checkpoints.

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
| `avgSpeed` | Complete-course average speed in mph, `null` for non-finishers or unavailable speeds; uses published mph or Athlinks speed records, falling back to published course distance and unrounded finish time |
| `courseDistance` | Published course distance in miles when available, otherwise `null`; Registericeman segment distances are summed through the finish |
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
Rider summaries and history show a finisher's published `avgSpeed`; when it is missing they calculate it from
the rider's `courseDistance`, or else from the distance implied by that event's other published speeds and
finish times (median of speed × time), divided by the rider's finish time.
The Iceman recap also plots the yearly fastest men's and women's average speeds, regardless of race group
or wave, with a Time/Speed toggle (default: Speed). Winners are selected by valid finish time, not by
highest reported speed. Speed uses each winner's published mph or Athlinks speed record, falling back to
published course distance and unrounded finish time, never an assumed distance. Missing years appear as gaps; point tooltips show each gender's
finisher count. The index includes each winner's finish time and average speed.
A separate course-distance chart uses the fastest finisher's published course distance (Athlinks course
distance or Registericeman finish-segment total). If only rounded mph and finish times are available,
distance is the mean of speed × time over every finisher with a published speed (the rounding
errors cancel) and is marked approximate with a hollow point. These are source distances,
not GPS measurements; missing years remain gaps. The index records `courseDistance` and
`courseDistanceEstimated`.
For the selected Iceman year, another chart plots median finish time by age and gender, regardless of
race group or wave. It prefers published ages and falls back to bounded division ages/ranges, plotted
at their midpoints with actual ranges in tooltips. Distinct ranges remain separate even when their
midpoints match. Open-ended divisions and catch-all ranges ending in 99 without a published age are
excluded, rather than treating (for example) Singlespeed Men 40-99 as riders aged 69.5.
The year recap is hidden while an individual rider's report is displayed.
Each rider finish-time distribution uses its own category's 99.5th percentile for the upper axis
bound, rounded up to a half hour and extended as needed to keep the rider's finish visible.
Histograms use 24 equal-width bins across that category's displayed range, so narrower ranges
also use narrower time bins.
Rider history marks years finishing within the published division podium depth (typically the top five).
Its finish trend can switch between time and average speed; speeds missing from the source are calculated from course distance and finish time, while
the results table combines finish time and average speed in one column, alongside time change.
Historical podium indicators use a compact colored trophy and place label.
When published wave time requirements are available, the recap charts each amateur's average of up to
three fastest unambiguous finishes in the five preceding calendar years against the time cutoff for their
actual wave. One histogram buckets how many minutes faster or slower the average is than that cutoff;
another shows how many waves earlier or later the actual assignment is than the wave implied by the average.
The time-margin histogram includes waves with "faster than" cutoffs (1-37); the wave-difference chart
also includes Wave 38's "or slower" threshold but excludes first-time Waves 39-48.
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
