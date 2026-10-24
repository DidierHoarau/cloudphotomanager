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
