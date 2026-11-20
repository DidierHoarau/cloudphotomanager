const PREFERENCES_MEMORIES_ENABLED = "preferences_memories_enabled";

export class PreferencesMemories {
  // Default on: a missing, corrupt or unreadable value never hides the
  // feature, so a storage failure cannot silently remove the Memories tab.
  public static isEnabled(): boolean {
    try {
      return localStorage.getItem(PREFERENCES_MEMORIES_ENABLED) !== "false";
    } catch {
      return true;
    }
  }

  public static setEnabled(value: boolean): void {
    try {
      localStorage.setItem(
        PREFERENCES_MEMORIES_ENABLED,
        value ? "true" : "false",
      );
    } catch {
      /* ignore quota / serialization errors */
    }
  }
}
