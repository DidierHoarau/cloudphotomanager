import { File } from "../model/File";
import {
  PlaceGeocoderFromDataset,
  PlaceGeocoderResolve,
  PlaceLabel,
  PlacesDataset,
} from "./PlaceGeocoder";

const fixture: PlacesDataset = {
  countries: { FR: "France", US: "United States" },
  regions: { "FR.A9": "Bretagne", "FR.A8": "Ile-de-France" },
  places: [
    ["Rennes", "FR", "A9", 48.11198, -1.67429, 221272],
    ["Paris", "FR", "A8", 48.8566, 2.3522, 2148271],
    // Very close to Rennes but far less populated: population breaks the tie.
    ["Village", "FR", "A9", 48.115, -1.68, 120],
    ["Ocean-free", "US", "CA", 34.05, -118.25, 4000000],
  ],
};

describe("PlaceGeocoder", () => {
  const geocoder = PlaceGeocoderFromDataset(fixture);

  it("resolves city, region and country from the nearest place", () => {
    const result = geocoder.resolve(48.11, -1.67);
    expect(result.status).toBe("ok");
    expect(result.city).toBe("Rennes");
    expect(result.region).toBe("Bretagne");
    expect(result.country).toBe("France");
    expect(result.countryCode).toBe("FR");
    expect(result.distanceKm).toBeLessThan(5);
  });

  it("prefers the more populated place for near-ties", () => {
    // Midway between Rennes and Village.
    const result = geocoder.resolve(48.1135, -1.677);
    expect(result.city).toBe("Rennes");
  });

  it("returns none beyond the distance threshold (ocean)", () => {
    const result = geocoder.resolve(0, -140);
    expect(result.status).toBe("none");
    expect(result.city).toBeNull();
    expect(result.country).toBeNull();
  });

  it("formats labels, skipping missing parts", () => {
    expect(
      PlaceLabel({ country: "France", region: "Bretagne", city: "Rennes" }),
    ).toBe("Rennes, Bretagne, France");
    expect(PlaceLabel({ country: "France", city: "Rennes" })).toBe(
      "Rennes, France",
    );
    expect(PlaceLabel({})).toBeNull();
  });

  it("fills the five place fields of a file from its GPS info", () => {
    const file = new File("account", "folder", "photo.jpg");
    file.info = {
      exif: {
        GPSInfo: { GPSLatitudeDecimal: 48.8566, GPSLongitudeDecimal: 2.3522 },
      },
    };
    expect(geocoder.fillFile(file)).toBe(true);
    expect(file.placeStatus).toBe("ok");
    expect(file.placeCity).toBe("Paris");
    expect(file.placeRegion).toBe("Ile-de-France");
    expect(file.placeCountry).toBe("France");
    expect(file.placeCountryCode).toBe("FR");
    // Second call is a no-op.
    expect(geocoder.fillFile(file)).toBe(false);
  });

  it("leaves files without GPS untouched", () => {
    const file = new File("account", "folder", "video.mp4");
    expect(geocoder.fillFile(file)).toBe(false);
    expect(file.placeStatus).toBeNull();
  });
});

describe("PlaceGeocoder committed dataset", () => {
  it("resolves Paris and Rennes with the bundled GeoNames data", () => {
    const paris = PlaceGeocoderResolve(48.8566, 2.3522);
    expect(paris.city).toBe("Paris");
    expect(paris.country).toBe("France");

    const rennes = PlaceGeocoderResolve(48.11198, -1.67429);
    expect(rennes.city).toBe("Rennes");
    // GeoNames admin1 names are the English/ASCII form ("Brittany").
    expect(rennes.region).toBe("Brittany");
    expect(rennes.country).toBe("France");
  });
});
