# Race data

## Files and build

Keep per-year race settings and archived source files in `<year>/race.json` and
`<year>/raw/`. Source archives and generated files should remain distinct: the site
uses the generated files, which are rebuilt with:

```sh
npm run build:data
```

| File | Purpose |
|---|---|
| `index.json` | Generated list of years, counts, and yearly summaries |
| `<year>/race.json` | Race settings, source paths, attribution, and data-specific overrides |
| `<year>/results.json` | Generated rider results used by the site |
| `<year>/splits.json` | Generated checkpoint data, when available |
| `splits.json` | Inventory of archived split sources |
| `<year>/raw/` | Archived source files; not published with the site |

Use the download commands in the root `package.json` to archive available results and
split sources. Rebuild generated data after changing source files or race settings.

## Results

`<year>/results.json` has the shape `{race, fields, riders}`. Each rider row follows
the field order in `fields`. Important fields include:

| Field | Meaning |
|---|---|
| `bib` | Bib number for that year |
| `person` | Year-independent key used to match riders across years |
| `name`, `city`, `age` | Published values; unavailable values are `null` |
| `status` | Overall place, or `DNF`, `DNS`, or `DSQ` |
| `net` | Finish time in seconds; `null` for non-finishers |
| `avgSpeed` | Published average speed in mph when available |
| `courseDistance` | Published course distance in miles when available |
| `gender`, `genderRank`, `division`, `divisionRank` | Published category and ranks |
| `start`, `wave` | Scheduled start in seconds after midnight and wave number |
| `raceGroup` | `amateur`, `junior`, `pro`, or `unclassified` |
| `raceEvent` | `iceman`, `junior-iceman`, or `slush-cup` |

Keep source values and attribution in the raw files and `race.json`; generated files
are rebuilt outputs. Do not infer a separate junior event from a junior age division.
Speed and course-distance values should reflect published source data when possible;
the builder applies documented fallbacks when sources omit them.

## Supplemental organizer data

Normalize public organizer exports to CSV in the year's `raw/` directory, then add a
`riderMetadata` entry to `race.json` with `format: "csv"`, its relative `path`, and
the `sourceUrl`.

Required headers are `bib,name,gender,net`. `net` uses `HH:MM:SS` and is blank for
non-finishers; `bib` may be blank when unavailable. Optional headers are
`wave,start,raceGroup,raceEvent,division,divisionRank`. `start` uses `HH:MM:SS`;
waves and division ranks are positive integers. Groups are `amateur`, `junior`, or
`pro`; events are `iceman`, `junior-iceman`, or `slush-cup`.

Every CSV row must match exactly one existing result. A wave without a start can use
the year's published amateur start schedule; without one, the start remains unknown.
Archive only public race fields, not private registration data.

## Checkpoint splits

`splits.json` lists archived split sources by year. The generated
`<year>/splits.json` has the shape
`{courses: [{checkpoints, riders}]}`. Each checkpoint has a name, cumulative `miles`
(or `null` if unknown), and optional location. Each rider's bib maps to elapsed
seconds at each checkpoint; missed checkpoints are `null`. Years without published
checkpoint data have no split file.

Use `race.json`'s `splitLocations` to associate a published split label with a known
location without altering its source. For 2025, `8.4 Mile` is Dockery Rd and
`16.6 Mile` is North Broomhead Rd.

RaceResult did not publish checkpoint distances for 2026. Its `splitDistances`
settings record GPS distances from the start to timing mats; the builder scales these
fractions to the year's implied course distance and marks the result estimated.
Checkpoints that violate the expected order are dropped.

## Historical wave schedules

Archived schedules are available for 2008, 2010, 2014, 2016, 2018, and 2019. Keep
the snapshot URL and normalized JSON path in each year's `race.json`; generated
`race.dataSources.waveSchedule` retains provenance. Schedule mappings may use
`starts`, exact `divisionWaves`, and `waveAssignments`.

Treat assignments as evidence-based: age alone does not establish a wave in the
2010 seeded/age-based schedule, and junior age categories do not establish entry in
the separate junior event. Early-season 2015/2017 captures are not verified race-day
schedules. Preserve published irregularities rather than normalizing them away.
