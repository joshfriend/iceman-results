# Iceman Cometh Results

An interactive explorer for Iceman Cometh race results, rider history, and checkpoint splits.
The site follows your device's light or dark appearance preference.
Rider history shows each year's published division and division place separately
from the overall amateur/pro/junior field placement.

The main recap compares finish times with box-and-whisker plots for gender and
race groups, plus published specialty classes such as singlespeed, fat tire,
tandem, Clydesdale, and Athena. Age divisions are combined, not start waves.
Overall groups include specialty-class riders; tandem is not split by gender.
Whiskers use 1.5×IQR fences, with finishes beyond the fences shown as outliers.
Category and rider plots share their drawing logic, with scattered finisher dots
and a horizontally scrolling tail beyond 2×IQR.
Both keep category/start-group labels and finisher counts/medians pinned while the
plot scrolls. Recap categories list Pro first, then division type alphabetically,
with genders grouped within each type.

Browse the site at [iceman.fueledbycaffeine.com](https://iceman.fueledbycaffeine.com).

Passing is estimated from scheduled starts and finish times within the rider's race
group, not observed on-course passes. The earliest wave caught excludes finishers
outside their wave's 1.5×IQR finish-time fences; the latest wave to pass the rider
uses all finishers. The earliest wave caught is not applicable to pros because the
course is cleared for their starts. Wave extremes can include the rider's own wave,
and only riders with a known wave and start time can determine them. Pass counts
remain unfiltered.

## Develop

Requires Node.js 22.12+ or 24+.

```sh
npm ci
npm run dev
npm test
```

Build and preview the production site with `npm run build` and `npm run preview`.

For data formats, source conventions, and update instructions, see
[data/README.md](data/README.md).

## Deploy

The site is hosted on GitHub Pages and deploys from `main` through GitHub Actions.
The custom domain is configured by `CNAME`.
