import { File } from "./File";
import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountDefinition } from "./AccountDefinition";
import { Folder } from "./Folder";

export interface Account {
  validate(context: Span): Promise<boolean>;
  listFolders(context: Span): Promise<Folder[]>;
  listFileInFolders(context: Span, folder: Folder): Promise<File[]>;
  downloadFile(context: Span, file: File, folder: string, filename: string): Promise<void>;
  getAccountDefinition(): AccountDefinition;
  updateFileMetadata(context: Span, file: File): Promise<void>;
  moveFile(context: Span, file: File, folderpathDestination: string): Promise<void>;
  getFolderByPath(context: Span, folderpath: string): Promise<Folder>;
}
