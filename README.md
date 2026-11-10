# Iceman Cometh 2026 — results explorer

Static GitHub Pages site. Enter a bib number (or name) to see:

- **You passed / Passed you / Net**: estimated from results. You passed a rider if they
  started at the same time as you or earlier and finished after you on the clock. A rider passed
  you if they started at the same time as you or later and finished before you. Clock finish =
  scheduled wave start + official net time. These counts leave out DNFs and repeated passes.
- **Division podium** (top 5): a trophy colored gold/silver/bronze for 1st–3rd, blue for 4th–5th;
  otherwise the time behind the division's 5th place.
- **Finish-time bell curves** (KDE + histogram) for overall, gender, division and the rider's start wave,
  shaded faster/slower than the rider, with official places.
- **Box plot by wave**: median ± 1 SD box, fastest–slowest range, every finisher as a dot,
  and the rider's wave and time highlighted.

Link to a rider directly with `?bib=4026`.

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css`, `js/app.js` | Page and D3 charts (D3 loaded from jsDelivr) |
| `js/stats.js` | Pure stats (passes, groups, KDE, wave stats) shared with tests |
| `data/iceman-2026.json` | Compact rider table the page loads |
| `data/raw/iceman-2026/` | Raw sources: RaceResult overall-results JSON and the start-list PDF as text |
| `scripts/build_data.py` | Rebuilds `data/iceman-2026.json` from the raw sources |

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
