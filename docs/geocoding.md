# Place names (reverse geocoding)

Photos that carry GPS coordinates are reverse-geocoded to human-readable place
names — city, region and country — without calling any external geocoding
service. Search, the File Info dialog, the metadata dialog and the map then
speak in place names instead of raw coordinates.

## Dataset

The place lookup uses a compact dataset bundled with the server:

- Source: [GeoNames](https://www.geonames.org/) `cities15000` (cities with more
  than 15,000 inhabitants), `admin1CodesASCII` (region names) and
  `countryInfo` (country names and ISO codes).
- License: CC BY 4.0. See the attribution section below.
- File: `cloudphotomanager-server/src/geo/data/places.json` (~1.7 MB,
  34,246 places, 252 countries, 3,865 regions at the time of writing).
- It is imported from `src` (`resolveJsonModule`) so `tsc` emits it into
  `dist/geo/data/places.json`; the Docker image and deployment manifests are
  unchanged.

The nearest place within **300 km** of a file's coordinates is used. When two
candidate places are within 1 km of each other the more populated one wins, so
a photo between a suburb and a city resolves to the city. Files farther than
300 km from any bundled city (typically over an ocean or in very remote areas)
get no place.

No public geocoder (Nominatim, Google, Mapbox, …) is queried, at sync time or
at request time: this avoids rate limits, API keys, per-photo cost and a hard
dependency on a third-party service for a debug/display feature. The trade-off
is coarse resolution (nearest city, not a street address) and no place name
over the open ocean.

### Regenerating the dataset

The generator is committed for reproducibility and is not run in CI:

```bash
cd cloudphotomanager-server
node scripts/build-places-dataset.mjs
```

It downloads `cities15000.zip`, `admin1CodesASCII.txt` and `countryInfo.txt`
from `download.geonames.org` and rewrites `src/geo/data/places.json`. It
requires network access and the system `unzip` binary.

After regenerating:

1. Review the diff (record counts, countries/regions) and run the geo tests:
   `npx jest --runInBand --coverage=false src/geo`.
2. Commit the regenerated JSON with the script/version change.
3. Build and redeploy; the new dataset is loaded at startup.

### Attribution

Place data from GeoNames is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). When redistributing
the application or the dataset, keep this attribution. The generator writes
the source, version, license and URL into the JSON header.

## Storage model

Migration `sql/init-0016.sql` adds five nullable columns to `files`:

| Column             | Meaning                                  |
| ------------------ | ---------------------------------------- |
| `placeCountry`     | Country name (e.g. `France`)             |
| `placeCountryCode` | ISO 3166-1 alpha-2 code (e.g. `FR`)      |
| `placeRegion`      | First-level administrative region        |
| `placeCity`        | Nearest city name                        |
| `placeStatus`      | Resolution state, see below              |

`placeStatus` values:

- `NULL` — not attempted yet (no GPS data, or awaiting the backfill).
- `ok` — a place was resolved and the four place columns are set.
- `none` — GPS is present but no bundled city is within the threshold.

Indexes `files_accountId_placeStatus` and
`files_accountId_place (accountId, placeCountry, placeRegion, placeCity)`
support the backfill scan and the exact place filter.

Place names are recomputed when a file's EXIF is (re)read by the sync, and are
reset when the file content changes (so a replaced file never keeps the old
place). Re-syncing metadata does not erase an already computed place.

## Backfill

Existing libraries are filled in the background:

- On boot, then daily according to `CRON_PLACE_BACKFILL` (default
  `15 2 * * *`).
- Only rows with GPS data and `placeStatus IS NULL` are selected, in batches of
  `PLACE_BACKFILL_BATCH_SIZE` (default `500`); each batch yields to the event
  loop so sync and requests keep running.
- It is idempotent: re-running skips resolved rows (`ok`/`none`) and rows
  without GPS.

Configuration (environment variable or configuration file):

| Option                      | Default        | Description                              |
| --------------------------- | -------------- | ---------------------------------------- |
| `PLACE_BACKFILL_ENABLED`    | `Y`            | Set to `N` to disable the backfill       |
| `CRON_PLACE_BACKFILL`       | `15 2 * * *`   | Backfill schedule                        |
| `PLACE_BACKFILL_BATCH_SIZE` | `500`          | Rows per batch                           |

The backfill does not depend on `AUTO_SYNC`: it also runs when automatic sync
is disabled.

## What uses place names

- **Search**: a place filter lists the places already resolved on the account;
  free-text search also matches the place columns, so `Brittany 2024` finds
  place-named photos as well as keyword matches.
- **File Info / metadata dialogs**: a Place row (with a link to the filtered
  search) and the place label next to the GPS coordinates.
- **Map**: each aggregated cell is labelled with its dominant place name and
  links to the corresponding filtered search (account, cell bounds and place).

## Known limits

- Resolution is "nearest city within 300 km", not an address.
- No place is returned over open oceans or areas farther than 300 km from any
  bundled city.
- Region/country names are the English GeoNames names.
