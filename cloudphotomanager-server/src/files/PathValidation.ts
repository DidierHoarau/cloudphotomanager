import * as path from "path";

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

// Returns an error message, or null when the filename is safe to use as a
// single path segment.
export function FileNameValidate(filename: unknown): string | null {
  if (typeof filename !== "string" || filename.trim().length === 0) {
    return "Missing: filename";
  }
  if (filename.length > 255) {
    return "Filename is too long";
  }
  if (filename === "." || filename === "..") {
    return "Invalid filename";
  }
  if (filename.includes("/") || filename.includes("\\")) {
    return "Filename cannot contain path separators";
  }
  if (hasControlCharacters(filename)) {
    return "Filename contains invalid characters";
  }
  if (filename.endsWith(".") || filename.endsWith(" ")) {
    return "Filename cannot end with a dot or a space";
  }
  return null;
}

// Returns an error message, or null when the folder path is a normalized
// absolute path that cannot escape its root.
export function FolderPathValidate(folderpath: unknown): string | null {
  if (typeof folderpath !== "string" || folderpath.length === 0) {
    return "Missing: folderpath";
  }
  if (folderpath.length > 4096) {
    return "Folder path is too long";
  }
  if (!folderpath.startsWith("/")) {
    return "Folder path must be absolute";
  }
  if (folderpath === "/") {
    return null;
  }
  if (folderpath.includes("\\") || hasControlCharacters(folderpath)) {
    return "Folder path contains invalid characters";
  }
  for (const segment of folderpath.split("/").slice(1)) {
    if (segment.length === 0) {
      return "Folder path has an empty segment";
    }
    if (segment === "." || segment === "..") {
      return "Folder path cannot contain relative segments";
    }
  }
  return null;
}

// True when target resolves inside rootpath (or is rootpath itself).
export function PathIsInsideRoot(rootpath: string, target: string): boolean {
  if (!rootpath || !target) {
    return false;
  }
  const root = path.resolve(rootpath);
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative === "") {
    return true;
  }
  if (path.isAbsolute(relative)) {
    return false;
  }
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}
