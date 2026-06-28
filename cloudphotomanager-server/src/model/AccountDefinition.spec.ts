import { AccountDefinition } from "./AccountDefinition";

describe("AccountDefinition", () => {
  describe("constructor", () => {
    it("should assign a non-empty id", () => {
      const def = new AccountDefinition();
      expect(def.id).toBeTruthy();
      expect(typeof def.id).toBe("string");
    });

    it("should generate a valid UUID", () => {
      const def = new AccountDefinition();
      expect(def.id).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
      );
    });

    it("should generate unique ids", () => {
      const def1 = new AccountDefinition();
      const def2 = new AccountDefinition();
      expect(def1.id).not.toBe(def2.id);
    });

    it("should have undefined properties initially", () => {
      const def = new AccountDefinition();
      expect(def.name).toBeUndefined();
      expect(def.rootpath).toBeUndefined();
      expect(def.info).toBeUndefined();
      expect(def.infoPrivate).toBeUndefined();
    });
  });
});
