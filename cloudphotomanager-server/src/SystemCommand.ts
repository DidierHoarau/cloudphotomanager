import * as childProcess from "child_process";

export class SystemCommand {
  //
  // Executes a binary with an argument array, without a shell: arguments
  // containing shell metacharacters are passed literally to the process.
  // Never build a command string from untrusted data.
  public static executeFile(
    binary: string,
    args: string[],
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      childProcess.execFile(binary, args, (error, stdout, stderr) => {
        if (error) {
          const err = error as childProcess.ExecFileException & {
            stdout?: string;
            stderr?: string;
          };
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
