import { Span } from "@opentelemetry/sdk-trace-base";
import axios from "axios";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import { File } from "../../model/File";
import { Folder } from "../../model/Folder";
import {
  ItemNotFoundError,
  OneDriveFileOperationsDeleteFolder,
  OneDriveFileOperationsDownloadFile,
  OneDriveFileOperationsDownloadThumbnail,
  OneDriveFileOperationsMoveFile,
  OneDriveFileOperationsRenameFile,
  OneDriveFileOperationsRenameFolder,
  ThumbnailNotAvailableError,
} from "./OneDriveFileOperations";
import { OneDriveInventoryGetFolderByPath } from "./OneDriveInventory";

jest.mock("./OneDriveInventory", () => ({
  OneDriveInventoryGetFolderByPath: jest.fn(),
}));

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  const axiosMock: any = jest.fn();
  axiosMock.isAxiosError = actual.isAxiosError;
  axiosMock.get = jest.fn();
  axiosMock.patch = jest.fn();
  axiosMock.delete = jest.fn();
  return { __esModule: true, default: axiosMock };
});

jest.mock("../../OTelContext", () => ({
  OTelLogger: () => ({
    createModuleLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }),
  OTelTracer: () => ({
    startSpan: () => mockSpan,
  }),
}));

const mockSpan = { end: jest.fn() } as unknown as Span;

const mockedAxios = axios as unknown as jest.Mock;

const THUMBNAIL_CDN_URL = "https://onedrivecdn.example/thumbnails/large.jpg";
const GRAPH_FALLBACK_THUMBNAIL_URL =
  "https://graph.microsoft.com/v1.0/me/drive/items/item-123/thumbnails/0/large/content";

function axiosErrorWithStatus(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}

function streamResponse(contentLength?: string): {
  data: PassThrough;
  headers: Record<string, string>;
} {
  const data = new PassThrough();
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) {
    headers["content-length"] = contentLength;
  }
  return { data, headers };
}

function mockOneDriveAccount(): { getToken: jest.Mock } {
  return {
    getToken: jest.fn().mockResolvedValue("test-token"),
  };
}

describe("OneDriveFileOperations", () => {
  let tempDir: string;
  let file: File;
  let oneDriveAccount: { getToken: jest.Mock };

  beforeEach(() => {
    jest.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "onedrive-fileops-"));
    file = new File("account-1", "folder-1", "photo.jpg");
    file.idCloud = "item-123";
    oneDriveAccount = mockOneDriveAccount();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("OneDriveFileOperationsDownloadThumbnail", () => {
    it("downloads the large thumbnail from the CDN without an Authorization header", async () => {
      const metadataResponse = {
        data: { value: [{ large: { url: THUMBNAIL_CDN_URL } }] },
      };
      const cdnResponse = streamResponse();
      cdnResponse.data.end("thumbnail-bytes");
      mockedAxios
        .mockResolvedValueOnce(metadataResponse)
        .mockResolvedValueOnce(cdnResponse);

      await OneDriveFileOperationsDownloadThumbnail(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "thumb.jpg",
      );

      expect(mockedAxios).toHaveBeenCalledTimes(2);
      expect(mockedAxios.mock.calls[0][0].url).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/item-123/thumbnails",
      );
      expect(mockedAxios.mock.calls[0][0].headers.Authorization).toBe(
        "Bearer test-token",
      );
      const cdnConfig = mockedAxios.mock.calls[1][0];
      expect(cdnConfig.url).toBe(THUMBNAIL_CDN_URL);
      expect(cdnConfig.headers?.Authorization).toBeUndefined();
      expect(cdnConfig.headers.Accept).toBe("*/*");
      expect(
        fs.readFileSync(path.join(tempDir, "thumb.jpg"), "utf-8"),
      ).toBe("thumbnail-bytes");
    });

    it("throws a clear error when OneDrive returns no thumbnail", async () => {
      mockedAxios.mockResolvedValueOnce({ data: { value: [] } });

      await expect(
        OneDriveFileOperationsDownloadThumbnail(
          mockSpan,
          oneDriveAccount as never,
          file,
          tempDir,
          "thumb.jpg",
        ),
      ).rejects.toThrow(/no large thumbnail/i);
      expect(mockedAxios).toHaveBeenCalledTimes(1);
    });

    it("maps a 404 on the thumbnail metadata endpoint to ItemNotFoundError", async () => {
      mockedAxios.mockRejectedValueOnce(axiosErrorWithStatus(404));

      const error = await OneDriveFileOperationsDownloadThumbnail(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "thumb.jpg",
      ).catch((caught) => caught);

      expect(error).toBeInstanceOf(ItemNotFoundError);
      expect(error.name).toBe("ItemNotFoundError");
      expect(error.message).toContain("item-123");
      expect(mockedAxios).toHaveBeenCalledTimes(1);
    });

    it("maps a 404 on the Graph fallback thumbnail download to ItemNotFoundError", async () => {
      const metadataResponse = {
        data: { value: [{ large: { url: THUMBNAIL_CDN_URL } }] },
      };
      mockedAxios
        .mockResolvedValueOnce(metadataResponse)
        .mockRejectedValueOnce(axiosErrorWithStatus(406))
        .mockRejectedValueOnce(axiosErrorWithStatus(404));

      const error = await OneDriveFileOperationsDownloadThumbnail(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "thumb.jpg",
      ).catch((caught) => caught);

      expect(error).toBeInstanceOf(ItemNotFoundError);
      expect(error.name).toBe("ItemNotFoundError");
      expect(error.message).toContain("item-123");
      expect(mockedAxios).toHaveBeenCalledTimes(3);
    });

    it("falls back to the Graph API thumbnail content endpoint when the CDN download fails", async () => {
      const metadataResponse = {
        data: { value: [{ large: { url: THUMBNAIL_CDN_URL } }] },
      };
      const fallbackResponse = streamResponse();
      fallbackResponse.data.end("fallback-bytes");
      mockedAxios
        .mockResolvedValueOnce(metadataResponse)
        .mockRejectedValueOnce(axiosErrorWithStatus(406))
        .mockResolvedValueOnce(fallbackResponse);

      await OneDriveFileOperationsDownloadThumbnail(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "thumb.jpg",
      );

      expect(mockedAxios).toHaveBeenCalledTimes(3);
      const fallbackConfig = mockedAxios.mock.calls[2][0];
      expect(fallbackConfig.url).toBe(GRAPH_FALLBACK_THUMBNAIL_URL);
      expect(fallbackConfig.headers.Authorization).toBe("Bearer test-token");
      expect(
        fs.readFileSync(path.join(tempDir, "thumb.jpg"), "utf-8"),
      ).toBe("fallback-bytes");
    });

    it("retries a transient 406 on the thumbnail metadata request", async () => {
      const metadataResponse = {
        data: { value: [{ large: { url: THUMBNAIL_CDN_URL } }] },
      };
      const cdnResponse = streamResponse();
      cdnResponse.data.end("thumbnail-bytes");
      mockedAxios
        .mockRejectedValueOnce(axiosErrorWithStatus(406))
        .mockResolvedValueOnce(metadataResponse)
        .mockResolvedValueOnce(cdnResponse);

      await OneDriveFileOperationsDownloadThumbnail(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "thumb.jpg",
      );

      expect(mockedAxios).toHaveBeenCalledTimes(3);
      expect(
        fs.readFileSync(path.join(tempDir, "thumb.jpg"), "utf-8"),
      ).toBe("thumbnail-bytes");
    }, 10000);

    it("falls back to the Graph content endpoint when the metadata request keeps returning 406", async () => {
      const fallbackResponse = streamResponse();
      fallbackResponse.data.end("fallback-bytes");
      mockedAxios
        .mockRejectedValueOnce(axiosErrorWithStatus(406))
        .mockRejectedValueOnce(axiosErrorWithStatus(406))
        .mockRejectedValueOnce(axiosErrorWithStatus(406))
        .mockResolvedValueOnce(fallbackResponse);

      await OneDriveFileOperationsDownloadThumbnail(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "thumb.jpg",
      );

      expect(mockedAxios).toHaveBeenCalledTimes(4);
      const fallbackConfig = mockedAxios.mock.calls[3][0];
      expect(fallbackConfig.url).toBe(GRAPH_FALLBACK_THUMBNAIL_URL);
      expect(fallbackConfig.headers.Authorization).toBe("Bearer test-token");
      expect(
        fs.readFileSync(path.join(tempDir, "thumb.jpg"), "utf-8"),
      ).toBe("fallback-bytes");
    }, 15000);

    it("throws ThumbnailNotAvailableError when metadata and the Graph fallback keep returning 406", async () => {
      for (let i = 0; i < 3; i++) {
        mockedAxios.mockRejectedValueOnce(axiosErrorWithStatus(406));
      }
      for (let i = 0; i < 3; i++) {
        mockedAxios.mockRejectedValueOnce(axiosErrorWithStatus(406));
      }

      const error = await OneDriveFileOperationsDownloadThumbnail(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "thumb.jpg",
      ).catch((caught) => caught);

      expect(error).toBeInstanceOf(ThumbnailNotAvailableError);
      expect(error.name).toBe("ThumbnailNotAvailableError");
      expect(error.message).toContain("item-123");
      expect(error.message).toContain("406");
      expect(mockedAxios).toHaveBeenCalledTimes(6);
    }, 20000);

    it("throws ThumbnailNotAvailableError when the Graph fallback keeps returning 416", async () => {
      mockedAxios
        .mockResolvedValueOnce({
          data: { value: [{ large: { url: THUMBNAIL_CDN_URL } }] },
        })
        .mockRejectedValueOnce(axiosErrorWithStatus(500))
        .mockRejectedValueOnce(axiosErrorWithStatus(416))
        .mockRejectedValueOnce(axiosErrorWithStatus(416))
        .mockRejectedValueOnce(axiosErrorWithStatus(416));

      const error = await OneDriveFileOperationsDownloadThumbnail(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "thumb.jpg",
      ).catch((caught) => caught);

      expect(error).toBeInstanceOf(ThumbnailNotAvailableError);
      expect(error.name).toBe("ThumbnailNotAvailableError");
      expect(error.message).toContain("item-123");
      expect(error.message).toContain("416");
      expect(mockedAxios).toHaveBeenCalledTimes(5);
    }, 20000);
  });

  describe("OneDriveFileOperationsDownloadFile", () => {
    it("downloads the file to the target path and verifies the content length", async () => {
      const response = streamResponse("11");
      response.data.end("photo-bytes");
      mockedAxios.mockResolvedValueOnce(response);

      await OneDriveFileOperationsDownloadFile(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "photo.jpg",
      );

      expect(mockedAxios).toHaveBeenCalledTimes(1);
      const config = mockedAxios.mock.calls[0][0];
      expect(config.url).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/item-123/content",
      );
      expect(config.headers.Authorization).toBe("Bearer test-token");
      expect(
        fs.readFileSync(path.join(tempDir, "photo.jpg"), "utf-8"),
      ).toBe("photo-bytes");
    });

    it("rejects and deletes the partial file when the source stream errors", async () => {
      const response = streamResponse();
      mockedAxios.mockResolvedValueOnce(response);
      response.data.write("partial-data");

      const download = OneDriveFileOperationsDownloadFile(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "photo.jpg",
      );
      await new Promise((resolve) => setImmediate(resolve));
      response.data.destroy(new Error("stream failure"));

      await expect(download).rejects.toThrow("stream failure");
      expect(fs.existsSync(path.join(tempDir, "photo.jpg"))).toBe(false);
    });

    it("rejects and deletes the partial file when the download is truncated", async () => {
      const response = streamResponse("100");
      response.data.end("short");
      mockedAxios.mockResolvedValueOnce(response);

      await expect(
        OneDriveFileOperationsDownloadFile(
          mockSpan,
          oneDriveAccount as never,
          file,
          tempDir,
          "photo.jpg",
        ),
      ).rejects.toThrow(/Truncated download/);
      expect(fs.existsSync(path.join(tempDir, "photo.jpg"))).toBe(false);
    });

    it("retries a transient 503 and succeeds", async () => {
      const response = streamResponse();
      response.data.end("photo-bytes");
      mockedAxios
        .mockRejectedValueOnce(axiosErrorWithStatus(503))
        .mockResolvedValueOnce(response);

      await OneDriveFileOperationsDownloadFile(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "photo.jpg",
      );

      expect(mockedAxios).toHaveBeenCalledTimes(2);
      expect(
        fs.readFileSync(path.join(tempDir, "photo.jpg"), "utf-8"),
      ).toBe("photo-bytes");
    }, 10000);

    it("does not retry a non-retryable error", async () => {
      mockedAxios.mockRejectedValueOnce(axiosErrorWithStatus(401));

      await expect(
        OneDriveFileOperationsDownloadFile(
          mockSpan,
          oneDriveAccount as never,
          file,
          tempDir,
          "photo.jpg",
        ),
      ).rejects.toThrow("HTTP 401");
      expect(mockedAxios).toHaveBeenCalledTimes(1);
    });

    it("maps a 404 to ItemNotFoundError without retrying", async () => {
      mockedAxios.mockRejectedValueOnce(axiosErrorWithStatus(404));

      const error = await OneDriveFileOperationsDownloadFile(
        mockSpan,
        oneDriveAccount as never,
        file,
        tempDir,
        "photo.jpg",
      ).catch((caught) => caught);

      expect(error).toBeInstanceOf(ItemNotFoundError);
      expect(error.name).toBe("ItemNotFoundError");
      expect(error.message).toContain("item-123");
      expect(mockedAxios).toHaveBeenCalledTimes(1);
    });
  });

  describe("move, rename and folder operations", () => {
    const getFolderByPathMock =
      OneDriveInventoryGetFolderByPath as unknown as jest.Mock;
    const patchMock = (axios as any).patch as jest.Mock;
    const deleteMock = (axios as any).delete as jest.Mock;

    it("moves a file by patching its parent and name", async () => {
      const destination = new Folder("account-1", "/b");
      destination.idCloud = "folder-b";
      getFolderByPathMock.mockResolvedValue(destination);
      patchMock.mockResolvedValueOnce({ data: {} });

      await OneDriveFileOperationsMoveFile(
        mockSpan,
        oneDriveAccount as never,
        file,
        "/b",
      );

      expect(getFolderByPathMock).toHaveBeenCalled();
      expect(patchMock).toHaveBeenCalledTimes(1);
      const [url, body, config] = patchMock.mock.calls[0];
      expect(url).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/item-123",
      );
      expect(body).toEqual({
        parentReference: { id: "folder-b" },
        name: "photo.jpg",
      });
      expect(config.headers.Authorization).toBe("Bearer test-token");
    });

    it("renames a file in place", async () => {
      patchMock.mockResolvedValueOnce({ data: {} });

      await OneDriveFileOperationsRenameFile(
        mockSpan,
        oneDriveAccount as never,
        file,
        "renamed.jpg",
      );

      expect(patchMock).toHaveBeenCalledTimes(1);
      const [url, body] = patchMock.mock.calls[0];
      expect(url).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/item-123",
      );
      expect(body).toEqual({ name: "renamed.jpg" });
    });

    it("deletes a folder", async () => {
      const folder = new Folder("account-1", "/b");
      folder.idCloud = "folder-b";
      deleteMock.mockResolvedValueOnce({ data: {} });

      await OneDriveFileOperationsDeleteFolder(
        mockSpan,
        oneDriveAccount as never,
        folder,
      );

      expect(deleteMock).toHaveBeenCalledTimes(1);
      expect(deleteMock.mock.calls[0][0]).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/folder-b",
      );
      expect(deleteMock.mock.calls[0][1]).toMatchObject({
        headers: { Authorization: "Bearer test-token" },
      });
    });

    it("renames a folder", async () => {
      const folder = new Folder("account-1", "/b");
      folder.idCloud = "folder-b";
      patchMock.mockResolvedValueOnce({ data: {} });

      await OneDriveFileOperationsRenameFolder(
        mockSpan,
        oneDriveAccount as never,
        folder,
        "renamed",
      );

      expect(patchMock).toHaveBeenCalledTimes(1);
      const [url, body] = patchMock.mock.calls[0];
      expect(url).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/folder-b",
      );
      expect(body).toEqual({ name: "renamed" });
    });
  });
});
