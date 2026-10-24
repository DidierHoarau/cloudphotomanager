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

  it("kills a hung command and rejects with a timeout error", async () => {
    const startedAt = Date.now();
    const error = await SystemCommand.executeFile(
      "sh",
      ["-c", "sleep 30"],
      { timeoutMs: 200 },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toMatch(/timed out after 200ms/);
    expect(Date.now() - startedAt).toBeLessThan(10000);
  });

  it("kills the command when the abort signal fires", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const promise = SystemCommand.executeFile("sh", ["-c", "sleep 30"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);

    const error = await promise.catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AbortError");
    expect(Date.now() - startedAt).toBeLessThan(10000);
  });

  it("rejects before spawning when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await SystemCommand.executeFile("sh", ["-c", "sleep 30"], {
      signal: controller.signal,
    }).catch((caught) => caught);

    expect(error.name).toBe("AbortError");
  });

  const itNotWindows = process.platform === "win32" ? it.skip : it;

  itNotWindows(
    "kills grandchild processes of the aborted command",
    async () => {
      const pidFile = path.join(tmpDir, "grandchild.pid");
      const controller = new AbortController();
      const promise = SystemCommand.executeFile(
        "sh",
        [
          "-c",
          `sleep 30 & echo $! > '${pidFile}'; wait`,
        ],
        { signal: controller.signal },
      );

      const waitStart = Date.now();
      while (!fs.existsSync(pidFile)) {
        if (Date.now() - waitStart > 5000) {
          throw new Error("grandchild pid file was not written");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const grandchildPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
      expect(grandchildPid).toBeGreaterThan(0);

      controller.abort();
      await promise.catch(() => undefined);

      const killStart = Date.now();
      let alive = true;
      while (alive) {
        alive = !isProcessGone(grandchildPid);
        if (!alive) {
          break;
        }
        if (Date.now() - killStart > 5000) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(alive).toBe(false);
    },
    20000,
  );
});

// A killed grandchild can linger as a zombie until PID 1 reaps it: that is
// already dead for our purposes (no code is running).
function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    const closeParen = stat.lastIndexOf(")");
    const state = stat.slice(closeParen + 2, closeParen + 3);
    return state === "Z";
  } catch {
    return true;
  }
}
