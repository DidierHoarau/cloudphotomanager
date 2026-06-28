import * as childProcess from "child_process";

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SystemCommand {
  //
  public static execute(command: string): Promise<string> {
    const exec = childProcess.exec;
    return new Promise<string>((resolve, reject) => {
      exec(command, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
