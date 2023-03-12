import { File } from "./File";
import { Span } from "@opentelemetry/sdk-trace-base";

export interface Account {
  validate(context: Span): Promise<boolean>;
  listFiles(context: Span): Promise<File[]>;
}
