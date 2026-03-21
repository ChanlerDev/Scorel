import { useEffect } from "react";

type ThemeName = "light" | "dark";

function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme(): void {
  useEffect(() => {
    applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    let disposed = false;

    window.scorel.app.getTheme().then((theme) => {
      if (!disposed) {
        applyTheme(theme === "dark" ? "dark" : "light");
      }
    }).catch(() => {
      // Ignore and keep the CSS media-query fallback.
    });

    const unsubscribe = window.scorel.app.onThemeChanged((theme) => {
      applyTheme(theme === "dark" ? "dark" : "light");
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
