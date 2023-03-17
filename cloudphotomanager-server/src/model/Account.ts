import { File } from "./File";
import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountDefinition } from "./AccountDefinition";

export interface Account {
  validate(context: Span): Promise<boolean>;
  listFiles(context: Span): Promise<File[]>;
  downloadFile(context: Span, file: File, folder: string, filename: string): Promise<void>;
  getAccountDefinition(): AccountDefinition;
  updateFileMetadata(context: Span, file: File): Promise<void>;
}
