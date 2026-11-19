// Keep-best heuristics for the duplicate review flow. Pure functions: the
// duplicate list payload already carries the metadata needed to rank copies,
// so the suggestion can be recomputed locally after a manual override.
//
// Ranking (first criterion wins):
//   1. higher pixel count        4. shallower folder
//   2. larger file size          5. cleaner then shorter filename
//   3. earlier capture date      6. lower id
// Local-drive/S3 rows carry no size or dimensions and their null dateMedia
// comes back as the 1970 epoch: all three are treated as unknown and rank
// last, so a tie-break still picks a deterministic copy.

export interface DuplicateReviewFile {
  id: string;
  filename?: string;
  folderId?: string;
  dateMedia?: string | number | Date | null;
  info?: { size?: number | string | null } | null;
  metadata?: any;
}

export interface DuplicateReviewGroup {
  hash: string;
  files: DuplicateReviewFile[];
}

export type DuplicateFolderPaths =
  | Map<string, string>
  | Record<string, string>
  | null
  | undefined;

export interface DuplicateKeepSuggestion {
  keepId: string | null;
  reason: string;
}

export interface DuplicateKeepResolution extends DuplicateKeepSuggestion {
  suggestedKeepId: string | null;
  isOverride: boolean;
}

export interface DuplicateTrashSummary {
  groupCount: number;
  fileCount: number;
  lines: string[];
  truncated: boolean;
  remaining: number;
}

const MEDIA_KEYS = ["image", "video", "photo"];
const COPY_MARKER = /(\bcopy\b|\(\d+\)|_copy\b|-copy\b)/i;

function folderPathGet(
  folderPaths: DuplicateFolderPaths,
  folderId: string | undefined,
): string | null {
  if (!folderId || !folderPaths) {
    return null;
  }
  if (folderPaths instanceof Map) {
    return folderPaths.get(folderId) ?? null;
  }
  const value = (folderPaths as Record<string, string>)[folderId];
  return typeof value === "string" ? value : null;
}

function keepGet(
  keepByHash: Map<string, string> | Record<string, string> | null | undefined,
  hash: string,
): string | null {
  if (!keepByHash) {
    return null;
  }
  if (keepByHash instanceof Map) {
    return keepByHash.get(hash) ?? null;
  }
  const value = (keepByHash as Record<string, string>)[hash];
  return typeof value === "string" ? value : null;
}

// Largest width*height across the provider media objects (OneDrive photo,
// image and video descriptors). Missing or invalid dimensions count as 0.
export function duplicatePixelCount(file: DuplicateReviewFile): number {
  const metadata = file?.metadata;
  if (!metadata || typeof metadata !== "object") {
    return 0;
  }
  let best = 0;
  for (const key of MEDIA_KEYS) {
    const media = metadata[key];
    if (!media || typeof media !== "object") {
      continue;
    }
    const width = Number(media.width);
    const height = Number(media.height);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      best = Math.max(best, width * height);
    }
  }
  return best;
}

export function duplicateFileSize(file: DuplicateReviewFile): number {
  const size = Number(file?.info?.size);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

// Capture time in epoch milliseconds, or null when unknown. The server stores
// SQL NULL dateMedia as the 1970 epoch, so 0 is treated as unknown.
export function duplicateCaptureTime(file: DuplicateReviewFile): number | null {
  const candidates = [file?.metadata?.photo?.takenDateTime, file?.dateMedia];
  for (const candidate of candidates) {
    const time = captureTimeParse(candidate);
    if (time !== null) {
      return time;
    }
  }
  return null;
}

function captureTimeParse(candidate: unknown): number | null {
  if (candidate === null || candidate === undefined || candidate === "") {
    return null;
  }
  let time: number;
  if (candidate instanceof Date) {
    time = candidate.getTime();
  } else if (typeof candidate === "number") {
    time = candidate;
  } else if (typeof candidate === "string") {
    time = Date.parse(candidate);
  } else {
    return null;
  }
  if (!Number.isFinite(time) || time === 0) {
    return null;
  }
  return time;
}

// Number of path segments below the account root: "/" is 0 and a missing
// path is unknown (ranked last).
export function duplicateFolderDepth(path: string | null | undefined): number {
  if (typeof path !== "string") {
    return Infinity;
  }
  const trimmed = path.trim();
  if (trimmed === "") {
    return Infinity;
  }
  return trimmed.split("/").filter((segment) => segment.length > 0).length;
}

function filenameClean(file: DuplicateReviewFile): boolean {
  const filename = file?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    return true;
  }
  return !COPY_MARKER.test(filename);
}

function filenameLength(file: DuplicateReviewFile): number {
  return typeof file?.filename === "string" ? file.filename.length : 0;
}

function compareIds(a: DuplicateReviewFile, b: DuplicateReviewFile): number {
  return String(a.id).localeCompare(String(b.id));
}

interface RankedCopy {
  file: DuplicateReviewFile;
  pixels: number;
  size: number;
  captureTime: number | null;
  depth: number;
  clean: boolean;
}

// Earlier captures rank first; unknown dates rank after every known date.
function compareCaptureTime(a: number | null, b: number | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a - b;
}

function buildRankedCopies(
  files: DuplicateReviewFile[],
  folderPaths: DuplicateFolderPaths,
): RankedCopy[] {
  return files.map((file) => ({
    file,
    pixels: duplicatePixelCount(file),
    size: duplicateFileSize(file),
    captureTime: duplicateCaptureTime(file),
    depth: duplicateFolderDepth(folderPathGet(folderPaths, file.folderId)),
    clean: filenameClean(file),
  }));
}

function compareRanked(a: RankedCopy, b: RankedCopy): number {
  if (a.pixels !== b.pixels) {
    return b.pixels - a.pixels;
  }
  if (a.size !== b.size) {
    return b.size - a.size;
  }
  const capture = compareCaptureTime(a.captureTime, b.captureTime);
  if (capture !== 0) {
    return capture;
  }
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }
  if (a.clean !== b.clean) {
    return a.clean ? -1 : 1;
  }
  if (filenameLength(a.file) !== filenameLength(b.file)) {
    return filenameLength(a.file) - filenameLength(b.file);
  }
  return compareIds(a.file, b.file);
}

function dimensionsLabel(file: DuplicateReviewFile): string {
  const metadata = file?.metadata;
  if (!metadata || typeof metadata !== "object") {
    return "";
  }
  let best = { width: 0, height: 0, pixels: 0 };
  for (const key of MEDIA_KEYS) {
    const media = metadata[key];
    if (!media || typeof media !== "object") {
      continue;
    }
    const width = Number(media.width);
    const height = Number(media.height);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0 &&
      width * height > best.pixels
    ) {
      best = { width, height, pixels: width * height };
    }
  }
  return best.pixels > 0 ? `${best.width}×${best.height}` : "";
}

function suggestionReason(
  winner: RankedCopy,
  runnerUp: RankedCopy | undefined,
): string {
  if (!runnerUp) {
    return "Tie-break";
  }
  if (winner.pixels > runnerUp.pixels) {
    const dimensions = dimensionsLabel(winner.file);
    return dimensions
      ? `Highest resolution (${dimensions})`
      : "Highest resolution";
  }
  if (winner.size > runnerUp.size) {
    return "Largest file";
  }
  if (
    winner.captureTime !== null &&
    (runnerUp.captureTime === null ||
      winner.captureTime < runnerUp.captureTime)
  ) {
    return "Earliest capture date";
  }
  if (winner.depth < runnerUp.depth) {
    return "Shallowest folder";
  }
  if (winner.clean !== runnerUp.clean) {
    return "Cleanest filename";
  }
  if (filenameLength(winner.file) < filenameLength(runnerUp.file)) {
    return "Cleanest filename";
  }
  return "Tie-break";
}

export function suggestDuplicateKeep(
  files: DuplicateReviewFile[],
  folderPathById: DuplicateFolderPaths = null,
): DuplicateKeepSuggestion {
  if (!Array.isArray(files) || files.length === 0) {
    return { keepId: null, reason: "Tie-break" };
  }
  const ranked = buildRankedCopies(files, folderPathById).sort(compareRanked);
  return {
    keepId: ranked[0].file.id,
    reason: suggestionReason(ranked[0], ranked[1]),
  };
}

// Uses the manual choice when it still belongs to the group, otherwise falls
// back to the suggested copy (e.g. after the chosen copy was trashed).
export function resolveDuplicateKeep(
  group: DuplicateReviewGroup,
  keepByHash: Map<string, string> | Record<string, string> | null | undefined,
  folderPaths: DuplicateFolderPaths = null,
): DuplicateKeepResolution {
  const files = group?.files ?? [];
  const suggestion = suggestDuplicateKeep(files, folderPaths);
  const chosen = keepGet(keepByHash, group?.hash);
  const chosenBelongs =
    chosen !== null && files.some((file) => file.id === chosen);
  if (chosenBelongs) {
    return {
      keepId: chosen,
      reason: suggestion.reason,
      suggestedKeepId: suggestion.keepId,
      isOverride: chosen !== suggestion.keepId,
    };
  }
  return {
    keepId: suggestion.keepId,
    reason: suggestion.reason,
    suggestedKeepId: suggestion.keepId,
    isOverride: false,
  };
}

// Every copy except each group's keep, in group order, de-duplicated.
export function duplicateRemovalIds(
  groups: DuplicateReviewGroup[],
  keepByHash: Map<string, string> | Record<string, string> | null | undefined,
  folderPaths: DuplicateFolderPaths = null,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const group of groups ?? []) {
    const keepId = resolveDuplicateKeep(group, keepByHash, folderPaths).keepId;
    for (const file of group.files ?? []) {
      if (file.id === keepId || seen.has(file.id)) {
        continue;
      }
      seen.add(file.id);
      ids.push(file.id);
    }
  }
  return ids;
}

function copyPath(
  file: DuplicateReviewFile,
  folderPaths: DuplicateFolderPaths,
): string {
  const folderPath = folderPathGet(folderPaths, file.folderId);
  const filename =
    typeof file?.filename === "string" && file.filename.length > 0
      ? file.filename
      : file?.id ?? "";
  if (folderPath === null) {
    return filename;
  }
  const base = folderPath === "/" ? "" : folderPath.replace(/\/+$/, "");
  return `${base}/${filename}`;
}

// Summary for the bulk confirmation dialog: how many groups/files would be
// moved, plus up to maxLines copy paths ("and N more" via remaining).
export function buildDuplicateTrashSummary(
  groups: DuplicateReviewGroup[],
  keepByHash: Map<string, string> | Record<string, string> | null | undefined,
  folderPaths: DuplicateFolderPaths = null,
  maxLines = 30,
): DuplicateTrashSummary {
  const allLines: string[] = [];
  let groupCount = 0;
  for (const group of groups ?? []) {
    const keepId = resolveDuplicateKeep(group, keepByHash, folderPaths).keepId;
    const removed = (group.files ?? []).filter((file) => file.id !== keepId);
    if (removed.length === 0) {
      continue;
    }
    groupCount++;
    for (const file of removed) {
      allLines.push(copyPath(file, folderPaths));
    }
  }
  const lineLimit = Number.isFinite(maxLines) && maxLines >= 0 ? maxLines : 30;
  const lines = allLines.slice(0, lineLimit);
  return {
    groupCount,
    fileCount: allLines.length,
    lines,
    truncated: allLines.length > lines.length,
    remaining: allLines.length - lines.length,
  };
}
