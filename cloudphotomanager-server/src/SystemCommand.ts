import * as childProcess from "child_process";

export interface SystemCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

// Generous default cap so a hung external tool (ffmpeg, darktable-cli,
// heif-convert) cannot keep a queue slot forever.
const DEFAULT_TIMEOUT_MS = 4 * 3600 * 1000;

export class SystemCommand {
  //
  // Executes a binary with an argument array, without a shell: arguments
  // containing shell metacharacters are passed literally to the process.
  // Never build a command string from untrusted data.
  //
  // The child is spawned as its own process group so that a timeout or an
  // AbortSignal terminates the whole tree (external tools spawn helpers).
  public static executeFile(
    binary: string,
    args: string[],
    options: SystemCommandOptions = {},
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const signal = options.signal;

    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(binary));
        return;
      }

      let child: childProcess.ChildProcess;
      try {
        child = childProcess.spawn(binary, args, {
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      let terminationError: Error | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;
      let killFallbackHandle: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killFallbackHandle) clearTimeout(killFallbackHandle);
        timeoutHandle = null;
        killFallbackHandle = null;
        signal?.removeEventListener("abort", onAbort);
      };

      const finish = (error: Error | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          const err = error as Error & { stdout?: string; stderr?: string };
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else {
          resolve(stdout);
        }
      };

      const killProcessGroup = () => {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
            return;
          } catch {
            // Process group already gone or never created: fall through.
          }
        }
        try {
          child.kill("SIGKILL");
        } catch {
          // Already dead.
        }
      };

      const terminate = (error: Error) => {
        if (settled || terminationError) return;
        terminationError = error;
        killProcessGroup();
        // Reject even if the "close" event never fires (e.g. a descendant
        // escaped the group and keeps the pipes open).
        killFallbackHandle = setTimeout(() => finish(terminationError), 1000);
        killFallbackHandle.unref?.();
      };

      const onAbort = () => terminate(abortError(binary));

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        finish(error);
      });

      child.on("close", (code, closeSignal) => {
        if (terminationError) {
          finish(terminationError);
          return;
        }
        if (code === 0) {
          finish(null);
          return;
        }
        const error = new Error(
          `Command ${binary} failed with ${
            code === null ? `signal ${closeSignal}` : `exit code ${code}`
          }`,
        ) as Error & {
          code?: number | string | null;
          signal?: NodeJS.Signals | null;
        };
        error.code = code;
        error.signal = closeSignal;
        finish(error);
      });

      timeoutHandle = setTimeout(() => {
        terminate(timeoutError(binary, timeoutMs));
      }, timeoutMs);
      timeoutHandle.unref?.();

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function timeoutError(binary: string, timeoutMs: number): Error {
  const err = new Error(`Command ${binary} timed out after ${timeoutMs}ms`);
  err.name = "TimeoutError";
  return err;
}

function abortError(binary: string): Error {
  const err = new Error(`Command ${binary} was aborted`);
  err.name = "AbortError";
  return err;
}
