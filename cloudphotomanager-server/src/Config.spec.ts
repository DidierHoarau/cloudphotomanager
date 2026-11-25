import * as fse from "fs-extra";
import path from "path";
import { Config } from "./Config";

describe("Config", () => {
  it("sets VERSION from the package.json adjacent to the compiled output", () => {
    const pkg = fse.readJsonSync(path.resolve(__dirname, "../package.json"));
    const config = new Config();
    expect(config.VERSION).toBe(pkg.version);
    expect(config.VERSION).not.toBe("1");
  });

  it("keeps the one-month login token lifetime after a config reload", async () => {
    const config = new Config();
    // Literal effective value from the session policy doc: 30-day validity.
    expect(config.JWT_VALIDITY_DURATION).toBe(2592000);
    await config.reload();
    expect(config.JWT_VALIDITY_DURATION).toBe(2592000);
    // Inherited from common-utils but unused: users/Auth.ts signs
    // exp = now + JWT_VALIDITY_DURATION and slides the httpOnly cookie
    // server-side; there is no absolute cap.
    expect(config.JWT_SESSION_MAX_DURATION).toBe(2592000);
  });

  it("reads and coerces the image classification settings from the environment", async () => {
    const prevModel = process.env.IMAGE_CLASSIFICATION_MODEL;
    const prevEnabled = process.env.IMAGE_CLASSIFICATION_ENABLED;
    process.env.IMAGE_CLASSIFICATION_MODEL = "Xenova/efficientnet-b0";
    process.env.IMAGE_CLASSIFICATION_ENABLED = "false";
    try {
      const config = new Config();
      await config.reload();

      expect(config.IMAGE_CLASSIFICATION_MODEL).toBe(
        "Xenova/efficientnet-b0",
      );
      expect(config.IMAGE_CLASSIFICATION_ENABLED).toBe(false);
    } finally {
      if (prevModel === undefined) {
        delete process.env.IMAGE_CLASSIFICATION_MODEL;
      } else {
        process.env.IMAGE_CLASSIFICATION_MODEL = prevModel;
      }
      if (prevEnabled === undefined) {
        delete process.env.IMAGE_CLASSIFICATION_ENABLED;
      } else {
        process.env.IMAGE_CLASSIFICATION_ENABLED = prevEnabled;
      }
    }
  });
});
