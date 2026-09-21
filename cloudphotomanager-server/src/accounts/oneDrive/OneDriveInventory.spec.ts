import { Span } from "@opentelemetry/sdk-trace-base";
import axios from "axios";
import { Folder } from "../../model/Folder";
import { OneDriveInventoryListFilesInFolder } from "./OneDriveInventory";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  const axiosMock = Object.assign(jest.fn(), {
    isAxiosError: actual.isAxiosError,
    get: jest.fn(),
  });
  return { __esModule: true, default: axiosMock };
});

const mockSpan = { end: jest.fn() } as unknown as Span;

const mockedAxiosGet = axios.get as unknown as jest.Mock;

function mockOneDriveAccount(): {
  getAccountDefinition: () => { id: string; rootpath: string };
  getToken: jest.Mock;
} {
  return {
    getAccountDefinition: () => ({ id: "account-1", rootpath: "/cloud" }),
    getToken: jest.fn().mockResolvedValue("test-token"),
  };
}

function rawFileItem(name: string, hashes: Record<string, string>): any {
  return {
    id: `item-${name}`,
    name,
    size: 123,
    lastModifiedDateTime: "2026-09-18T00:00:00.000Z",
    fileSystemInfo: { createdDateTime: "2026-09-18T00:00:00.000Z" },
    file: { hashes },
  };
}

describe("OneDriveInventory", () => {
  let oneDriveAccount: ReturnType<typeof mockOneDriveAccount>;
  let folder: Folder;

  beforeEach(() => {
    jest.resetAllMocks();
    oneDriveAccount = mockOneDriveAccount();
    folder = new Folder("account-1", "/photos");
  });

  describe("OneDriveInventoryListFilesInFolder hash extraction", () => {
    it("prefers quickXorHash, the only hash guaranteed by Graph v1.0", async () => {
      mockedAxiosGet
        .mockResolvedValueOnce({ data: { id: "folder-cloud-id" } })
        .mockResolvedValueOnce({
          data: {
            value: [
              rawFileItem("photo.jpg", {
                quickXorHash: "QUICKXORHASHVALUE",
                sha256Hash: "SHA256VALUE",
              }),
            ],
          },
        });

      const files = await OneDriveInventoryListFilesInFolder(
        mockSpan,
        oneDriveAccount as never,
        folder,
      );

      expect(files).toHaveLength(1);
      expect(files[0].hash).toBe("QUICKXORHASHVALUE");
    });

    it("falls back to sha256Hash when quickXorHash is absent", async () => {
      mockedAxiosGet
        .mockResolvedValueOnce({ data: { id: "folder-cloud-id" } })
        .mockResolvedValueOnce({
          data: {
            value: [
              rawFileItem("photo.jpg", { sha256Hash: "SHA256VALUE" }),
            ],
          },
        });

      const files = await OneDriveInventoryListFilesInFolder(
        mockSpan,
        oneDriveAccount as never,
        folder,
      );

      expect(files).toHaveLength(1);
      expect(files[0].hash).toBe("SHA256VALUE");
    });

    it("never leaves hash undefined when the item reports no hashes", async () => {
      mockedAxiosGet
        .mockResolvedValueOnce({ data: { id: "folder-cloud-id" } })
        .mockResolvedValueOnce({
          data: {
            value: [rawFileItem("photo.jpg", {})],
          },
        });

      const files = await OneDriveInventoryListFilesInFolder(
        mockSpan,
        oneDriveAccount as never,
        folder,
      );

      expect(files).toHaveLength(1);
      expect(files[0].hash).toBe("");
    });

    it("never leaves hash undefined when the item has no file facet", async () => {
      mockedAxiosGet
        .mockResolvedValueOnce({ data: { id: "folder-cloud-id" } })
        .mockResolvedValueOnce({
          data: {
            value: [
              {
                id: "item-package",
                name: "note.one",
                size: 456,
                lastModifiedDateTime: "2026-09-18T00:00:00.000Z",
                fileSystemInfo: {
                  createdDateTime: "2026-09-18T00:00:00.000Z",
                },
              },
            ],
          },
        });

      const files = await OneDriveInventoryListFilesInFolder(
        mockSpan,
        oneDriveAccount as never,
        folder,
      );

      expect(files).toHaveLength(1);
      expect(files[0].hash).toBe("");
    });
  });
});
