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
| `status` | Overall place (number) or `DNF` / `DNS` / `DSQ` |
| `net` | Official net time in seconds, `null` if none |
| `gender`, `genderRank` | `M`/`F` and gender place |
| `division`, `divisionRank` | Division name and place |
| `start`, `wave` | Scheduled start (seconds after midnight) and wave number |

Cross-year history, year switching, and wave estimates prefer matching nonzero Athlinks rider
IDs, even when names differ, and reject conflicting nonzero IDs. When either ID is unavailable,
the existing name matching and ambiguity rules apply. Names alone cannot establish identity;
an entry without an ID can still be attributed to the wrong same-name rider.
Cross-year matches must also have compatible ages: age change must be within elapsed calendar
years plus or minus one. When a published age is missing, a recognizable division age range
is used instead; equipment/category names alone are not evidence of age. Missing age evidence
does not reject a match. Conflicting matches are silently omitted, even when rider IDs match.
Switching to an unrestricted singlespeed, tandem, or other category does not break a match.
If that result publishes an age, it is still checked; otherwise it contributes no age constraint.
Known ages on either side of such a year are still compared using the full elapsed years.
History checks against the selected result first, then against accepted results nearest that
year; wave estimates also check against accepted years. The selected result is always retained.
Registericeman and RaceResult IDs are not Athlinks IDs and are never compared with them.
For 2025, Registericeman remains the primary source for results, divisions, and waves. The
`athlinksIdentity` configuration supplements rider IDs from the downloaded Athlinks results
only when bib, full name (case-insensitive), gender, and finish time match a unique primary
result; conflicting or unmatched nonzero IDs fail the build rather than guessing.
2026 has no Athlinks identity supplement, so its `athlinksRacerId` is `null`.

The history downloader also saves `raw/athlinks-metadata.json` and
`raw/athlinks-divisions.json` for each Athlinks year, fetching division pages in parallel.
The builder joins official division names and ranks to overall results by course, bib, full
published name, gender, and millisecond finish time. It does not derive divisions from age
or mistake gender-only groups for divisions. Missing or ambiguous memberships stay unavailable
and are reported during the build. The category-specific courses already used for 2003 remain
its divisions; 2025 retains Registericeman's divisions and 2026 retains RaceResult's.
Some historical ranks skip places because of ties; podium gaps use the last published rank
within the top five, or show an unavailable time if no podium finisher is present.

## Develop

```sh
npm run download:history # fetch Athlinks results for 2001–2025; preserve primary sources
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
