export interface DuplicateIgnoreInfo {
  fileCount?: number;
  filename?: string;
  folderId?: string;
}

export interface DuplicateIgnore {
  accountId: string;
  hash: string;
  dateIgnored: string;
  userId?: string;
  info: DuplicateIgnoreInfo;
}
