import {
  MoveConflictError,
  SyncFailureConflict,
  SyncFailureConflictSnapshot,
} from "./SyncMoveConflict";

describe("SyncFailureConflictSnapshot", () => {
  it("should match the expected shape", () => {
    const snapshot: SyncFailureConflictSnapshot = {
      filename: "photo.jpg",
      folderpath: "/photos/vacation",
      dateMedia: "2024-01-15T10:00:00.000Z",
      size: 2048576,
    };
    expect(snapshot.filename).toBe("photo.jpg");
    expect(snapshot.folderpath).toBe("/photos/vacation");
    expect(snapshot.dateMedia).toBe("2024-01-15T10:00:00.000Z");
    expect(snapshot.size).toBe(2048576);
  });

  it("should allow null dateMedia and size", () => {
    const snapshot: SyncFailureConflictSnapshot = {
      filename: "file.txt",
      folderpath: "/docs",
      dateMedia: null,
      size: null,
    };
    expect(snapshot.dateMedia).toBeNull();
    expect(snapshot.size).toBeNull();
  });
});

describe("SyncFailureConflict", () => {
  it("should match the expected shape", () => {
    const conflict: SyncFailureConflict = {
      sourceFileId: "file-source-123",
      targetFileId: "file-target-456",
      targetFolderId: "folder-target-789",
      targetFolderpath: "/photos/target",
      targetFilename: "photo.jpg",
      source: {
        filename: "photo.jpg",
        folderpath: "/photos/source",
        dateMedia: "2024-01-15T10:00:00.000Z",
        size: 2048576,
      },
      target: {
        filename: "photo.jpg",
        folderpath: "/photos/target",
        dateMedia: "2024-01-15T10:00:00.000Z",
        size: 1048576,
      },
    };
    expect(conflict.sourceFileId).toBe("file-source-123");
    expect(conflict.targetFileId).toBe("file-target-456");
    expect(conflict.targetFilename).toBe("photo.jpg");
    expect(conflict.source.filename).toBe("photo.jpg");
    expect(conflict.target.filename).toBe("photo.jpg");
  });

  it("should allow null targetFileId and targetFolderId", () => {
    const conflict: SyncFailureConflict = {
      sourceFileId: "file-source-123",
      targetFileId: null,
      targetFolderId: null,
      targetFolderpath: "/photos/target",
      targetFilename: "photo.jpg",
      source: {
        filename: "photo.jpg",
        folderpath: "/photos/source",
        dateMedia: null,
        size: null,
      },
      target: {
        filename: "photo.jpg",
        folderpath: "/photos/target",
        dateMedia: null,
        size: null,
      },
    };
    expect(conflict.targetFileId).toBeNull();
    expect(conflict.targetFolderId).toBeNull();
  });
});

describe("MoveConflictError", () => {
  it("should create error with default message", () => {
    const conflict: SyncFailureConflict = {
      sourceFileId: "src-id",
      targetFileId: "tgt-id",
      targetFolderId: "tgt-folder-id",
      targetFolderpath: "/photos/target",
      targetFilename: "photo.jpg",
      source: {
        filename: "photo.jpg",
        folderpath: "/photos/source",
        dateMedia: null,
        size: null,
      },
      target: {
        filename: "photo.jpg",
        folderpath: "/photos/target",
        dateMedia: null,
        size: null,
      },
    };
    const error = new MoveConflictError(conflict);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MoveConflictError");
    expect(error.message).toBe(
      "Move conflict: photo.jpg already exists in /photos/target",
    );
  });

  it("should store the conflict data", () => {
    const conflict: SyncFailureConflict = {
      sourceFileId: "src-id",
      targetFileId: null,
      targetFolderId: null,
      targetFolderpath: "/photos/target",
      targetFilename: "image.png",
      source: {
        filename: "image.png",
        folderpath: "/photos/source",
        dateMedia: "2024-06-01T00:00:00.000Z",
        size: 512000,
      },
      target: {
        filename: "image.png",
        folderpath: "/photos/target",
        dateMedia: "2024-06-01T00:00:00.000Z",
        size: 512000,
      },
    };
    const error = new MoveConflictError(conflict);
    expect(error.conflict).toBe(conflict);
    expect(error.conflict.source.filename).toBe("image.png");
    expect(error.conflict.target.folderpath).toBe("/photos/target");
  });
});
