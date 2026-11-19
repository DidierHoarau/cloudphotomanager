import { Span } from "@opentelemetry/sdk-trace";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsInit,
  SqlDbUtilsQuerySQL,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { AccountDefinition } from "../model/AccountDefinition";
import { PlaceGeocoderFromDataset, PlacesDataset } from "./PlaceGeocoder";
import { PlaceBackfillRun } from "./PlaceBackfill";

const fixture: PlacesDataset = {
  countries: { FR: "France" },
  regions: { "FR.A9": "Bretagne" },
  places: [["Rennes", "FR", "A9", 48.11198, -1.67429, 221272]],
};

describe("PlaceBackfillRun", () => {
  let span: Span;
  let dataDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");
  const accountId = "account-place-backfill";

  function insertFile(
    id: string,
    info: any,
    trashed = 0,
  ): void {
    const now = new Date().toISOString();
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO files (id, idCloud, accountId, folderId, filename, dateSync, " +
        "dateUpdated, dateMedia, hash, info, metadata, trashed) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        `cloud/${id}`,
        accountId,
        "folder-1",
        `${id}.jpg`,
        now,
        now,
        now,
        `hash-${id}`,
        JSON.stringify(info),
        "{}",
        trashed,
      ],
    );
  }

  function placeRow(id: string): any {
    return SqlDbUtilsQuerySQL(
      span,
      "SELECT placeCity, placeRegion, placeCountry, placeCountryCode, placeStatus " +
        "FROM files WHERE id = ?",
      [id],
    )[0];
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-place-backfill-"));
    dataDir = path.join(baseDir, "data");
    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("PlaceBackfill.spec");
    await fs.ensureDir(dataDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    const account = new AccountDefinition();
    account.id = accountId;
    account.name = "place-account";
    account.rootpath = "/cloud";
    account.info = { type: "localDrive" };
    account.infoPrivate = {};
    SqlDbUtilsExecSQL(
      span,
      "INSERT INTO accounts (id, name, rootpath, info, infoPrivate) VALUES (?, ?, ?, ?, ?)",
      [
        account.id,
        account.name,
        account.rootpath,
        JSON.stringify(account.info),
        JSON.stringify(account.infoPrivate),
      ],
    );

    insertFile("file-rennes", {
      exif: {
        GPSInfo: { GPSLatitudeDecimal: 48.11198, GPSLongitudeDecimal: -1.67429 },
      },
    });
    insertFile("file-ocean", {
      exif: {
        GPSInfo: { GPSLatitudeDecimal: 0, GPSLongitudeDecimal: -140 },
      },
    });
    // No GPS: must stay placeStatus NULL and never be selected again.
    insertFile("file-nogps", {});
    // Trashed files are skipped.
    insertFile(
      "file-trashed",
      {
        exif: {
          GPSInfo: { GPSLatitudeDecimal: 48.11198, GPSLongitudeDecimal: -1.67429 },
        },
      },
      1,
    );
  });

  it("resolves places once and is idempotent", async () => {
    const first = await PlaceBackfillRun(span, {
      geocoder: PlaceGeocoderFromDataset(fixture),
      batchSize: 2,
    });
    expect(first.processed).toBe(2);
    expect(first.ok).toBe(1);
    expect(first.none).toBe(1);

    expect(placeRow("file-rennes")).toEqual({
      placeCity: "Rennes",
      placeRegion: "Bretagne",
      placeCountry: "France",
      placeCountryCode: "FR",
      placeStatus: "ok",
    });
    expect(placeRow("file-ocean").placeStatus).toBe("none");
    expect(placeRow("file-nogps").placeStatus).toBeNull();
    expect(placeRow("file-trashed").placeStatus).toBeNull();

    const second = await PlaceBackfillRun(span, {
      geocoder: PlaceGeocoderFromDataset(fixture),
      batchSize: 2,
    });
    expect(second.processed).toBe(0);
  });
});
