import * as _ from "lodash";

const PREFERENCES_LABELS_DISPLAY = "preferences_folders_display";

export class PreferencesFolders {
  //
  public static isCollapsed(accountId: string, folderId: string): boolean {
    const preferences = JSON.parse(localStorage.getItem(PREFERENCES_LABELS_DISPLAY) as string) || [];
    return (_.find(preferences, { accountId, folderId }) || { accountId, folderId, isCollapsed: false }).isCollapsed;
  }

  public static toggleCollapsed(accountId: string, folderId: string): void {
    const preferences = JSON.parse(localStorage.getItem(PREFERENCES_LABELS_DISPLAY) as string) || [];
    let folderPreferences = _.find(preferences, { folderId });
    if (!folderPreferences) {
      folderPreferences = { accountId, folderId, isCollapsed: false };
      preferences.push(folderPreferences);
    }
    folderPreferences.isCollapsed = !folderPreferences.isCollapsed;
    localStorage.setItem(PREFERENCES_LABELS_DISPLAY, JSON.stringify(preferences));
  }
}
