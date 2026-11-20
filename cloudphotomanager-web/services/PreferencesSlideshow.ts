import { normalizeSlideshowOptions } from "../utils/Slideshow";
import type { SlideshowOptions } from "../utils/Slideshow";

const SLIDESHOW_OPTIONS = "slideshowOptions";

export class PreferencesSlideshow {
  public static getOptions(): SlideshowOptions {
    try {
      const raw = localStorage.getItem(SLIDESHOW_OPTIONS);
      return normalizeSlideshowOptions(raw ? JSON.parse(raw) : null);
    } catch {
      return normalizeSlideshowOptions(null);
    }
  }

  public static setOptions(options: SlideshowOptions): void {
    try {
      localStorage.setItem(SLIDESHOW_OPTIONS, JSON.stringify(options));
    } catch {
      /* ignore quota / serialization errors */
    }
  }
}
