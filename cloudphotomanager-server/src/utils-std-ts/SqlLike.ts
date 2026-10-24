// Escapes LIKE wildcards so a value is matched literally. Patterns built with
// it must be used with `ESCAPE '\'`.
export function SqlEscapeLike(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

// Builds the LIKE pattern matching the subtree of a folder path: the exact
// folder (callers compare folderpath = ? separately) and every descendant.
// Callers pass the result to `folderpath LIKE ? ESCAPE '\'`.
export function SqlFolderSubtreePattern(folderpath: string): string {
  const prefix = folderpath === "/" ? "/" : `${folderpath}/`;
  return `${SqlEscapeLike(prefix)}%`;
}
