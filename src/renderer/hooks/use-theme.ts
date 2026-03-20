import { useEffect } from "react";

type ThemeName = "light" | "dark";

function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme(): void {
  useEffect(() => {
    applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    return window.scorel.app.onThemeChanged((theme) => {
      applyTheme(theme === "dark" ? "dark" : "light");
    });
  }, []);
}
