import { find } from "lodash";

const PREFERENCES_LABELS_DISPLAY = "preferences_folders_display";

interface FolderPreference {
  accountId: string;
  folderId: string;
  isCollapsed: boolean;
}

let _cache: FolderPreference[] | null = null;

function _load(): FolderPreference[] {
  if (_cache !== null) return _cache;
  try {
    _cache = JSON.parse(
      localStorage.getItem(PREFERENCES_LABELS_DISPLAY) as string,
    ) as FolderPreference[];
  } catch {
    _cache = [];
  }
  if (!Array.isArray(_cache)) _cache = [];
  return _cache;
}

function _persist(): void {
  try {
    localStorage.setItem(PREFERENCES_LABELS_DISPLAY, JSON.stringify(_cache));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export class PreferencesFolders {
  public static isCollapsed(accountId: string, folderId: string): boolean {
    const prefs = _load();
    const pref = find(prefs, { accountId, folderId });
    return pref ? pref.isCollapsed : false;
  }

  public static toggleCollapsed(accountId: string, folderId: string): void {
    const prefs = _load();
    let pref = find(prefs, { accountId, folderId });
    if (!pref) {
      pref = { accountId, folderId, isCollapsed: false };
      prefs.push(pref);
    }
    pref.isCollapsed = !pref.isCollapsed;
    _persist();
  }

  public static setCollapsed(
    accountId: string,
    folderId: string,
    isCollapsed: boolean,
  ): void {
    const prefs = _load();
    let pref = find(prefs, { accountId, folderId });
    if (!pref) {
      pref = { accountId, folderId, isCollapsed };
      prefs.push(pref);
    } else {
      pref.isCollapsed = isCollapsed;
    }
    _persist();
  }
}
