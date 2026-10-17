// Shared labels for sync operation names, used by the toast messages, the
// notification center and anywhere a completed operation is displayed.
export const SYNC_OPERATION_LABELS: Record<string, string> = {
  fileDelete: "Delete complete",
  fileTrash: "Moved to Trash",
  fileRestore: "Restore complete",
  folderMove: "Move complete",
  fileRename: "Rename complete",
};

export function syncOperationLabel(operationName: string): string {
  return SYNC_OPERATION_LABELS[operationName] || "Operation complete";
}
