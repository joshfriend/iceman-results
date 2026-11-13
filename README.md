# Iceman Cometh Results

An interactive explorer for Iceman Cometh race results, rider history, and checkpoint splits.

Browse the site at [iceman.fueledbycaffeine.com](https://iceman.fueledbycaffeine.com).

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
