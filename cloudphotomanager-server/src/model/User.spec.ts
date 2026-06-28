import { User } from "./User";

describe("User", () => {
  describe("constructor", () => {
    it("should assign a non-empty id", () => {
      const user = new User();
      expect(user.id).toBeTruthy();
      expect(typeof user.id).toBe("string");
    });

    it("should generate a UUID", () => {
      const user = new User();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(user.id).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
      );
    });

    it("should generate unique ids for different instances", () => {
      const user1 = new User();
      const user2 = new User();
      expect(user1.id).not.toBe(user2.id);
    });

    it("should have undefined properties for uninitialized fields", () => {
      const user = new User();
      expect(user.name).toBeUndefined();
      expect(user.passwordEncrypted).toBeUndefined();
    });
  });

  describe("toJson", () => {
    it("should return id, name, and passwordEncrypted", () => {
      const user = new User();
      user.name = "testuser";
      user.passwordEncrypted = "$2b$10$abc123";
      const json = user.toJson();
      expect(json).toEqual({
        id: user.id,
        name: "testuser",
        passwordEncrypted: "$2b$10$abc123",
      });
    });

    it("should reflect changes to properties", () => {
      const user = new User();
      user.name = "updateduser";
      const json = user.toJson();
      expect(json.name).toBe("updateduser");
    });
  });
});
