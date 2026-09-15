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
});
