/**
 * The color theme: light, dark, or follow the operating system. The choice lives in localStorage (absent = follow the system);
 * what is painted is the `data-theme="light|dark"` attribute on <html>, which the CSS in globals.css turns into colors.
 */

export const THEME_KEY = "scaffolder-theme";
export const THEME_EVENT = "scaffolder-theme-change";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "system", "dark"];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(choice: ThemeChoice, systemPrefersLight: boolean): ResolvedTheme {
  return choice === "system" ? (systemPrefersLight ? "light" : "dark") : choice;
}

/**
 * Runs in <head> before the page is painted, so a reader who chose (or whose system uses) the light theme never sees a dark flash.
 * Plain ES5 on purpose: it is inlined as text. If storage is blocked the system setting still decides; if the system setting cannot be read either, the dark theme stays.
 */
export const THEME_INIT_SCRIPT =
  `(function(){var t=null,d="dark";try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}` +
  `try{d=t==="light"||t==="dark"?t:(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark")}catch(e){d=t==="light"?"light":"dark"}` +
  `document.documentElement.setAttribute("data-theme",d)})();`;

// --- the browser side: one small external store, read with useSyncExternalStore ---

const LIGHT_QUERY = "(prefers-color-scheme: light)";

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice, window.matchMedia(LIGHT_QUERY).matches);
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage blocked: the choice still applies to this page */
  }
  applyTheme(choice);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** For useSyncExternalStore: changes made here, in another tab, or by the operating system (while following it). */
export function subscribeToTheme(onChange: () => void): () => void {
  const media = window.matchMedia(LIGHT_QUERY);
  const onSystem = () => {
    applyTheme(readThemeChoice());
    onChange();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY || e.key === null) onSystem();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onSystem);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onSystem);
  };
}
