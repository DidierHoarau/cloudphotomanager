import { File } from "../model/File";
import { Folder } from "../model/Folder";
import {
  BulkZipDedupeNames,
  BulkZipEntryNameAccount,
  BulkZipEntryNameBasename,
  BulkZipEntryNameSharedRoot,
  BulkZipItem,
} from "./BulkZipDownload";

function folder(accountId: string, folderpath: string): Folder {
  return { id: `folder-${folderpath}`, accountId, folderpath } as any;
}

function file(folderpath: string, filename: string): File {
  return {
    id: `file-${folderpath}-${filename}`,
    folderId: `folder-${folderpath}`,
    filename,
  } as any;
}

function item(folderpath: string, filename: string): BulkZipItem {
  return {
    file: file(folderpath, filename),
    folder: folder("account", folderpath),
    entryName: BulkZipEntryNameBasename(folder("account", folderpath), file(folderpath, filename)),
  };
}

describe("BulkZipDownload entry naming", () => {
  it("names account-wide entries by their full folder path", () => {
    expect(
      BulkZipEntryNameAccount(folder("a", "/"), file("/", "root.jpg")),
    ).toBe("root.jpg");
    expect(
      BulkZipEntryNameAccount(
        folder("a", "/2026/trip"),
        file("/2026/trip", "photo.jpg"),
      ),
    ).toBe("2026/trip/photo.jpg");
  });

  it("names shared-folder entries relative to the shared root only", () => {
    const shared = folder("a", "/personal/2026");
    expect(
      BulkZipEntryNameSharedRoot(
        shared.folderpath,
        shared,
        file(shared.folderpath, "root.jpg"),
      ),
    ).toBe("root.jpg");
    expect(
      BulkZipEntryNameSharedRoot(
        shared.folderpath,
        folder("a", "/personal/2026/sub"),
        file("/personal/2026/sub", "deep.jpg"),
      ),
    ).toBe("sub/deep.jpg");
    // A sibling with a shared prefix is not inside the shared subtree.
    expect(
      BulkZipEntryNameSharedRoot(
        shared.folderpath,
        folder("a", "/personal/2026-other"),
        file("/personal/2026-other", "leak.jpg"),
      ),
    ).toBeNull();
    expect(
      BulkZipEntryNameSharedRoot(
        "/",
        folder("a", "/anything"),
        file("/anything", "x.jpg"),
      ),
    ).toBe("x.jpg");
  });

  it("names album entries by their last folder segment", () => {
    expect(
      BulkZipEntryNameBasename(
        folder("a", "/2026/trip"),
        file("/2026/trip", "photo.jpg"),
      ),
    ).toBe("trip/photo.jpg");
    expect(
      BulkZipEntryNameBasename(folder("a", "/"), file("/", "photo.jpg")),
    ).toBe("photo.jpg");
  });

  it("dedupes colliding entry names before the extension", () => {
    const items = [
      item("/one", "photo.jpg"),
      item("/one", "photo.jpg"),
      item("/two", "photo.jpg"),
      item("/one", "note"),
      item("/one", "note"),
    ];
    expect(BulkZipDedupeNames(items).map((entry) => entry.entryName)).toEqual([
      "one/photo.jpg",
      "one/photo (2).jpg",
      "two/photo.jpg",
      "one/note",
      "one/note (2)",
    ]);
  });
});
