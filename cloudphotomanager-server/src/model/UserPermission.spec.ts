import { UserPermission } from "./UserPermission";

describe("UserPermission", () => {
  describe("constructor", () => {
    it("should assign a non-empty id", () => {
      const perm = new UserPermission();
      expect(perm.id).toBeTruthy();
      expect(typeof perm.id).toBe("string");
    });

    it("should generate a valid UUID", () => {
      const perm = new UserPermission();
      expect(perm.id).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
      );
    });

    it("should generate unique ids", () => {
      const perm1 = new UserPermission();
      const perm2 = new UserPermission();
      expect(perm1.id).not.toBe(perm2.id);
    });

    it("should set default isAdmin to false", () => {
      const perm = new UserPermission();
      expect(perm.info.isAdmin).toBe(false);
    });

    it("should set default folders to empty array", () => {
      const perm = new UserPermission();
      expect(perm.info.folders).toEqual([]);
    });
  });

  describe("toJson", () => {
    it("should return id, userId, and info", () => {
      const perm = new UserPermission();
      perm.userId = "user-1";
      const json = perm.toJson();
      expect(json).toEqual({
        id: perm.id,
        userId: "user-1",
        info: { isAdmin: false, folders: [] },
      });
    });

    it("should reflect updated properties", () => {
      const perm = new UserPermission();
      perm.userId = "user-2";
      perm.info.isAdmin = true;
      perm.info.folders = [{ folderId: "f1", scope: "read" }];
      const json = perm.toJson();
      expect(json.info.isAdmin).toBe(true);
      expect(json.info.folders).toHaveLength(1);
      expect(json.info.folders[0].folderId).toBe("f1");
    });
  });
});
