import { FileUtils } from "../services/FileUtils";

export const SLIDESHOW_INTERVALS = [3, 5, 10, 15, 30];
export const SLIDESHOW_DEFAULT_INTERVAL = 5;

export interface SlideshowOptions {
  interval: number;
  loop: boolean;
  shuffle: boolean;
}

export function normalizeSlideshowInterval(value: unknown): number {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(seconds)) {
    return SLIDESHOW_DEFAULT_INTERVAL;
  }
  let nearest = SLIDESHOW_INTERVALS[0];
  for (const candidate of SLIDESHOW_INTERVALS) {
    if (Math.abs(candidate - seconds) < Math.abs(nearest - seconds)) {
      nearest = candidate;
    }
  }
  return nearest;
}

export function normalizeSlideshowOptions(raw: unknown): SlideshowOptions {
  const source = raw !== null && typeof raw === "object" ? (raw as any) : {};
  return {
    interval: normalizeSlideshowInterval(source.interval),
    loop: typeof source.loop === "boolean" ? source.loop : true,
    shuffle: typeof source.shuffle === "boolean" ? source.shuffle : false,
  };
}

function isPlayableFile(file: any): boolean {
  return !!file && !FileUtils.isOuttake(file) && FileUtils.getType(file) !== "unknown";
}

// Order as indices into the files array, so positions stay meaningful after
// the caller's arrays change. Shuffle uses an injectable RNG for tests.
export function buildSlideshowOrder(
  files: any[],
  shuffle: boolean,
  random: () => number = Math.random,
): number[] {
  const order: number[] = [];
  (files || []).forEach((file, index) => {
    if (isPlayableFile(file)) {
      order.push(index);
    }
  });
  if (!shuffle) {
    return order;
  }
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  return order;
}

export function nextSlideshowPosition(
  order: number[],
  current: number,
  loop: boolean,
): number | null {
  if (!order || order.length === 0) {
    return null;
  }
  const index = order.indexOf(current);
  if (index < 0) {
    // Current file is not part of the order (e.g. an outtake): go to the
    // first playable file after it, else wrap (or stop without loop).
    const after = order.filter((position) => position > current);
    if (after.length > 0) {
      return Math.min(...after);
    }
    return loop ? order[0] : null;
  }
  if (index + 1 < order.length) {
    return order[index + 1];
  }
  return loop ? order[0] : null;
}

export function previousSlideshowPosition(
  order: number[],
  current: number,
  loop: boolean,
): number | null {
  if (!order || order.length === 0) {
    return null;
  }
  const index = order.indexOf(current);
  if (index < 0) {
    const before = order.filter((position) => position < current);
    if (before.length > 0) {
      return Math.max(...before);
    }
    return loop ? order[order.length - 1] : null;
  }
  if (index - 1 >= 0) {
    return order[index - 1];
  }
  return loop ? order[order.length - 1] : null;
}

export function slideshowSourceFiles(
  files: any[],
  selectedFiles: any[],
): any[] {
  const source =
    selectedFiles && selectedFiles.length > 0 ? selectedFiles : files || [];
  return source.filter(isPlayableFile);
}
