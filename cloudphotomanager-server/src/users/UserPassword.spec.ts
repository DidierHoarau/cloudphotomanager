import { User } from "../model/User";
import {
  UserPasswordCheckPassword,
  UserPasswordSetPassword,
} from "./UserPassword";

describe("UserPassword", () => {
  it("should successfully verify the correct password", async () => {
    const password = "testPassword1234";
    const user = new User();
    await UserPasswordSetPassword(null, user, password);
    expect(await UserPasswordCheckPassword(null, user, password)).toBeTruthy();
  });

  it("should fail to verify an incorrect password", async () => {
    const password = "testPassword1234";
    const passwordWrong = "testPassword12345";
    const user = new User();
    await UserPasswordSetPassword(null, user, password);
    expect(
      await UserPasswordCheckPassword(null, user, passwordWrong),
    ).toBeFalsy();
  });

  it("should handle empty password", async () => {
    const user = new User();
    await UserPasswordSetPassword(null, user, "");
    expect(await UserPasswordCheckPassword(null, user, "")).toBeTruthy();
  });

  it("should handle very long password", async () => {
    const longPassword = "a".repeat(100);
    const user = new User();
    await UserPasswordSetPassword(null, user, longPassword);
    expect(
      await UserPasswordCheckPassword(null, user, longPassword),
    ).toBeTruthy();
  });

  it("should handle password with special characters", async () => {
    const specialPassword = "!@#$%^&*()_+-=[]{}|;':\",./<>?~`";
    const user = new User();
    await UserPasswordSetPassword(null, user, specialPassword);
    expect(
      await UserPasswordCheckPassword(null, user, specialPassword),
    ).toBeTruthy();
  });

  it("should produce different hashes for the same password (salting)", async () => {
    const password = "samePassword123";
    const user1 = new User();
    const user2 = new User();
    await UserPasswordSetPassword(null, user1, password);
    await UserPasswordSetPassword(null, user2, password);
    // With salt, the encrypted strings should be different
    expect(user1.passwordEncrypted).not.toBe(user2.passwordEncrypted);
    // But both should still verify the password
    expect(await UserPasswordCheckPassword(null, user1, password)).toBeTruthy();
    expect(await UserPasswordCheckPassword(null, user2, password)).toBeTruthy();
  });
});
