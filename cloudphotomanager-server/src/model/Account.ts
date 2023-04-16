import { File } from "./File";
import { Span } from "@opentelemetry/sdk-trace-base";
import { AccountDefinition } from "./AccountDefinition";
import { Folder } from "./Folder";
import { AccountCapabilities } from "./AccountCapabilities";

export interface Account {
  validate(context: Span): Promise<boolean>;
  listFilesInFolder(context: Span, folder: Folder): Promise<File[]>;
  listFoldersInFolder(context: Span, folder: Folder): Promise<Folder[]>;
  downloadFile(context: Span, file: File, folder: string, filename: string): Promise<void>;
  downloadPreview(context: Span, file: File, folder: string, filename: string): Promise<void>;
  downloadThumbnail(context: Span, file: File, folder: string, filename: string): Promise<void>;
  getAccountDefinition(): AccountDefinition;
  updateFileMetadata(context: Span, file: File): Promise<void>;
  moveFile(context: Span, file: File, folderpathDestination: string): Promise<void>;
  deleteFile(context: Span, file: File): Promise<void>;
  getFolder(context: Span, folder: Folder): Promise<Folder>;
  getFolderByPath(context: Span, folderpath: string): Promise<Folder>;
  getCapabilities(): AccountCapabilities;
}
