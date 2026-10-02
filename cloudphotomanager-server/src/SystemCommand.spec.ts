import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { SystemCommand } from "./SystemCommand";

describe("SystemCommand.executeFile", () => {
  let tmpDir: string;
  let sentinelPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-systemcommand-"));
    sentinelPath = path.join(tmpDir, "sentinel");
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("passes shell metacharacters literally to the process", async () => {
    const hostileArgs = [
      `a; touch ${sentinelPath}`,
      "$(id).jpg",
      "`id`.jpg",
      'a"b.jpg',
      "a b.jpg",
      "a'b.jpg",
      "a&&b.jpg",
      "a|b.jpg",
      "a\\;b.jpg",
      "*.jpg",
    ];

    const stdout = await SystemCommand.executeFile("printf", [
      "%s\n",
      ...hostileArgs,
    ]);

    // printf prints each argv element on its own line: every element must
    // arrive byte-for-byte, proving no shell ever parsed them.
    expect(stdout.split("\n").slice(0, hostileArgs.length)).toEqual(
      hostileArgs,
    );
    expect(await fs.pathExists(sentinelPath)).toBe(false);
  });

  it("does not expand command substitution inside a filename argument", async () => {
    const payload = `$(touch ${sentinelPath})`;
    const stdout = await SystemCommand.executeFile("printf", [
      "%s",
      `photo-${payload}.jpg`,
    ]);

    expect(stdout).toBe(`photo-${payload}.jpg`);
    expect(await fs.pathExists(sentinelPath)).toBe(false);
  });

  it("rejects with the exit error and captured stderr on failure", async () => {
    await expect(
      SystemCommand.executeFile(process.execPath, [
        "-e",
        "console.error('boom-error'); process.exit(3)",
      ]),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining("boom-error"),
    });
  });

  it("rejects when the binary does not exist", async () => {
    await expect(
      SystemCommand.executeFile("/nonexistent/cpm-binary", []),
    ).rejects.toBeDefined();
  });
});
