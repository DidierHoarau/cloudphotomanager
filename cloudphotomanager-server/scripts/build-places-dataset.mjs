#!/usr/bin/env node
// Build the bundled reverse-geocoding dataset from GeoNames.
//
// Prerequisites: network access and the system `unzip`. The generated file
// (src/geo/data/places.json) is committed so the server never queries a
// remote geocoder at runtime. Run this script only when refreshing the data:
//
//   node scripts/build-places-dataset.mjs
//
// Source data: https://download.geonames.org/export/dump/
//   cities15000.zip       (populated places with >= 15000 inhabitants)
//   admin1CodesASCII.txt  (admin1/region codes -> names)
//   countryInfo.txt       (ISO country codes -> names)
// License: Creative Commons Attribution 4.0 (CC BY 4.0), see
// https://www.geonames.org/about.html and docs/geocoding.md.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "https://download.geonames.org/export/dump";
const OUT_FILE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../src/geo/data/places.json",
);

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function lines(text) {
  return text.split("\n").filter((line) => line && !line.startsWith("#"));
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-places-"));
  try {
    const citiesZip = path.join(tmpDir, "cities15000.zip");
    fs.writeFileSync(citiesZip, await download(`${BASE}/cities15000.zip`));
    const citiesText = execFileSync("unzip", ["-p", citiesZip, "cities15000.txt"], {
      maxBuffer: 256 * 1024 * 1024,
    }).toString("utf8");
    const admin1Text = (await download(`${BASE}/admin1CodesASCII.txt`)).toString("utf8");
    const countryText = (await download(`${BASE}/countryInfo.txt`)).toString("utf8");

    const countries = {};
    for (const line of lines(countryText)) {
      const cols = line.split("\t");
      const code = cols[0];
      const name = cols[4];
      if (code && name) {
        countries[code] = name;
      }
    }

    const regions = {};
    for (const line of lines(admin1Text)) {
      const cols = line.split("\t");
      const code = cols[0];
      const name = cols[1];
      if (code && name) {
        regions[code] = name;
      }
    }

    const places = [];
    for (const line of lines(citiesText)) {
      const cols = line.split("\t");
      const name = cols[1];
      const lat = parseFloat(cols[4]);
      const lon = parseFloat(cols[5]);
      const countryCode = cols[8];
      const admin1 = cols[10];
      const population = parseInt(cols[14], 10) || 0;
      if (!name || !countryCode || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        continue;
      }
      places.push([name, countryCode, admin1 || "", lat, lon, population]);
    }

    // Keep the file deterministic so a refresh produces a readable diff.
    places.sort((a, b) => {
      return (
        a[1].localeCompare(b[1]) ||
        a[2].localeCompare(b[2]) ||
        b[5] - a[5] ||
        a[0].localeCompare(b[0])
      );
    });

    const dataset = {
      source: "GeoNames",
      version: new Date().toISOString().slice(0, 10),
      license: "CC BY 4.0",
      url: "https://www.geonames.org/",
      countries,
      regions,
      places,
    };
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(dataset));
    const size = fs.statSync(OUT_FILE).size;
    console.log(
      `Wrote ${places.length} places, ${Object.keys(countries).length} countries, ` +
        `${Object.keys(regions).length} regions to ${OUT_FILE} (${(size / 1024 / 1024).toFixed(2)} MB)`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
