import crypto from "crypto";

export function UtilsMd5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}
