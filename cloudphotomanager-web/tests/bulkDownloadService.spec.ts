import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BulkDownloadService,
  MAX_BUFFERED_BYTES,
  MAX_BUFFERED_FILES,
  buildZipFilename,
} from "../services/BulkDownloadService";

function stubDocument() {
  const link = { href: "", download: "", click: vi.fn() };
  const body = { appendChild: vi.fn(), removeChild: vi.fn() };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => link),
    body,
  });
  return { link, body };
}

function stubWindow(options: { picker?: any; secure?: boolean } = {}) {
  const win: any = { isSecureContext: options.secure ?? true };
  if (options.picker) {
    win.showSaveFilePicker = options.picker;
  }
  vi.stubGlobal("window", win);
  return win;
}

function bulkFiles(count: number, size = 10) {
  return Array.from({ length: count }, (_, i) => ({
    id: `f${i}`,
    filename: `photo-${i}.jpg`,
    info: { size },
  }));
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildZipFilename", () => {
  it("formats the download timestamp like the previous client code", () => {
    expect(buildZipFilename(new Date("2026-11-03T10:20:30.123Z"))).toBe(
      "photos-2026-11-03T10-20-30.zip",
    );
  });
});

describe("BulkDownloadService buffered fallback", () => {
  it("posts the selection and triggers the browser download", async () => {
    stubWindow({ secure: false });
    const { link, body } = stubDocument();
    const fetchMock = vi.fn(async () => new Response("zip-bytes"));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    await BulkDownloadService.downloadZip("a1", bulkFiles(2));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/a1/files/batch/operations/fileDownload",
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIdList: ["f0", "f1"] }),
      },
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(link.download).toMatch(/^photos-.*\.zip$/);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(body.appendChild).toHaveBeenCalledWith(link);
    expect(body.removeChild).toHaveBeenCalledWith(link);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("refuses selections above the in-memory cap", async () => {
    stubWindow({ secure: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      BulkDownloadService.downloadZip(
        "a1",
        bulkFiles(MAX_BUFFERED_FILES + 1),
      ),
    ).rejects.toThrow(/cannot stream downloads/);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      BulkDownloadService.downloadZip("a1", [
        { id: "f0", info: { size: MAX_BUFFERED_BYTES + 1 } },
      ]),
    ).rejects.toThrow(/cannot stream downloads/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server error message", async () => {
    stubWindow({ secure: false });
    stubDocument();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(400, { error: "Invalid filename in selection" }),
      ),
    );
    const createObjectURL = vi.spyOn(URL, "createObjectURL");

    const error: any = await BulkDownloadService.downloadZip("a1", [
      { id: "f0" },
    ]).catch((err) => err);

    expect(error.message).toBe("Invalid filename in selection");
    expect(error.response.data.error).toBe("Invalid filename in selection");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe("BulkDownloadService streamed download", () => {
  it("pipes the response body into the picked file", async () => {
    const chunks: number[] = [];
    const writable = {
      write: vi.fn(async (data: Uint8Array) => {
        chunks.push(...data);
      }),
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    const handle = { createWritable: vi.fn(async () => writable) };
    const picker = vi.fn(async () => handle);
    stubWindow({ picker, secure: true });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.enqueue(new TextEncoder().encode("def"));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
    const createObjectURL = vi.spyOn(URL, "createObjectURL");

    await BulkDownloadService.downloadZip("a1", bulkFiles(2));

    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: expect.stringMatching(/^photos-.*\.zip$/),
      }),
    );
    expect(writable.write).toHaveBeenCalledTimes(2);
    expect(new TextDecoder().decode(new Uint8Array(chunks))).toBe("abcdef");
    expect(writable.close).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("does nothing when the user cancels the picker", async () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    stubWindow({ picker: vi.fn(async () => Promise.reject(abort)) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      BulkDownloadService.downloadZip("a1", bulkFiles(1)),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the buffered download when the picker fails", async () => {
    stubWindow({
      picker: vi.fn(async () => Promise.reject(new Error("not supported"))),
    });
    const { link } = stubDocument();
    const fetchMock = vi.fn(async () => new Response("zip-bytes"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    await BulkDownloadService.downloadZip("a1", bulkFiles(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(link.click).toHaveBeenCalledTimes(1);
  });
});
