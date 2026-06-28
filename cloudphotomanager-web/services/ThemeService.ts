const UI_THEME_KEY = "UI_THEME";

export class ThemeService {
  //
  public static applyTheme(): void {
    const storedTheme = localStorage.getItem(UI_THEME_KEY);
    let isDark = false;
    if (storedTheme === "dark" || storedTheme === "light") {
      isDark = storedTheme === "dark";
    } else {
      isDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    document.documentElement.setAttribute(
      "data-theme",
      isDark ? "dark" : "light",
    );
    localStorage.setItem(UI_THEME_KEY, isDark ? "dark" : "light");
  }

  public static toggleTheme(): boolean {
    const current = document.documentElement.getAttribute("data-theme");
    const isDark = current !== "light";
    const newTheme = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem(UI_THEME_KEY, newTheme);
    return !isDark;
  }

  public static isDark(): boolean {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }
}
