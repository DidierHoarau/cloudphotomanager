import { Folder } from "./Folder";

describe("Folder", () => {
  describe("constructor", () => {
    it("should set accountId and folderpath from arguments", () => {
      const folder = new Folder("acct1", "/photos/vacation");
      expect(folder.accountId).toBe("acct1");
      expect(folder.folderpath).toBe("/photos/vacation");
    });

    it("should generate a deterministic id based on URI-encoded input", () => {
      const folder1 = new Folder("acct1", "/photos/vacation");
      const folder2 = new Folder("acct1", "/photos/vacation");
      expect(folder1.id).toBe(folder2.id);
    });

    it("should generate different ids for different accountId", () => {
      const folder1 = new Folder("acct1", "/photos/vacation");
      const folder2 = new Folder("acct2", "/photos/vacation");
      expect(folder1.id).not.toBe(folder2.id);
    });

    it("should generate different ids for different folderpath", () => {
      const folder1 = new Folder("acct1", "/photos/vacation");
      const folder2 = new Folder("acct1", "/photos/other");
      expect(folder1.id).not.toBe(folder2.id);
    });

    it("should have a 32-character hex id", () => {
      const folder = new Folder("acct1", "/photos/vacation");
      expect(folder.id).toHaveLength(32);
      expect(/^[a-f0-9]{32}$/.test(folder.id)).toBe(true);
    });

    it("should initialize info as empty object", () => {
      const folder = new Folder("acct1", "/photos/vacation");
      expect(folder.info).toEqual({});
    });
  });
});
