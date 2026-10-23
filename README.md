# sparo-data

The daily data behind the Sparø app (www.sparø.dk): this week's avis offers and today's Stop madspild items.

A GitHub Actions job ([`.github/workflows/sync.yml`](.github/workflows/sync.yml)) runs once a day:

- **Offers** from the [ShelfAtlas](https://shelfatlas.com) public catalog API (`scripts/sync-offers.mjs`): a full fetch on Sundays (about 30 requests), and on other days only the offers added since the last run (a few requests), about 250 a month.
- **Stop madspild** from the [Salling Group](https://developer.sallinggroup.dev) Anti Food Waste API, 76 requests a run, covering
  every Netto, føtex and Bilka (`scripts/sync-madspild.mjs`). The request points in `scripts/points.json` were planned from the stores' locations
  (© OpenStreetMap contributors).

The output is `offers.json` and `clearances.json`. The data isn't kept in this repository: each run replaces the last.

## Setup

Repository secrets (Settings → Secrets and variables → Actions):

- `SHELFATLAS_KEY`: the ShelfAtlas API key
- `SALLING_TOKEN`: the Salling Group API token

To publish the files for the app, make the repository public, set Settings → Pages → Source to "GitHub Actions", and add the
repository variable `PUBLISH` with the value `true`.

Offers via ShelfAtlas. Stop madspild © Salling Group. Sparø is free and non-commercial.
