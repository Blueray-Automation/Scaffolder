import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import colors from "tailwindcss/colors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  isThemeChoice,
  readThemeChoice,
  resolveTheme,
  setThemeChoice,
  subscribeToTheme,
  THEME_CHOICES,
  THEME_EVENT,
  THEME_INIT_SCRIPT,
  THEME_KEY,
} from "@/lib/theme";
import tailwind from "../../../tailwind.config";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const css = readFileSync(join(REPO, "src", "app", "globals.css"), "utf8");

type Rgb = [number, number, number];

function paletteOf(selector: string): Record<string, Rgb> {
  const start = css.indexOf(selector);
  expect(start, `${selector} not found in globals.css`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--c-([a-z]+-\d+):\s*(\d+) (\d+) (\d+);/g)].map((m) => [m[1]!, [Number(m[2]), Number(m[3]), Number(m[4])] as Rgb]));
}

const dark = paletteOf(":root {");
const light = paletteOf(':root[data-theme="light"]');

const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const luminance = ([r, g, b]: Rgb) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** `fg` at `alpha` painted over `bg`: what an opacity modifier such as bg-zinc-900/60 looks like. */
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;

describe("choosing a theme", () => {
  it("follows the system unless a theme was chosen", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("accepts only the three choices", () => {
    for (const ok of ["light", "dark", "system"]) expect(isThemeChoice(ok)).toBe(true);
    for (const bad of ["", "Light", "auto", null, undefined, 1]) expect(isThemeChoice(bad)).toBe(false);
    expect([...THEME_CHOICES]).toEqual(["light", "system", "dark"]);
  });
});

describe("the script that runs before the page is painted (no flash of the wrong theme)", () => {
  /** Runs the real script text against a fake browser. */
  function run(opts: { stored?: string | null; storageThrows?: boolean; systemLight?: boolean; matchMediaThrows?: boolean }): string | undefined {
    let attribute: string | undefined;
    const localStorage = {
      getItem: (key: string) => {
        if (opts.storageThrows) throw new Error("blocked");
        expect(key).toBe(THEME_KEY);
        return opts.stored ?? null;
      },
    };
    const window = {
      matchMedia: (query: string) => {
        if (opts.matchMediaThrows) throw new Error("no matchMedia");
        expect(query).toBe("(prefers-color-scheme: light)");
        return { matches: Boolean(opts.systemLight) };
      },
    };
    const document = { documentElement: { setAttribute: (name: string, value: string) => (name === "data-theme" ? (attribute = value) : undefined) } };
    new Function("localStorage", "window", "document", THEME_INIT_SCRIPT)(localStorage, window, document);
    return attribute;
  }

  it("uses the stored choice, whatever the system says", () => {
    expect(run({ stored: "light", systemLight: false })).toBe("light");
    expect(run({ stored: "dark", systemLight: true })).toBe("dark");
  });

  it("follows the system when nothing valid is stored", () => {
    for (const stored of [null, "system", "", "Light", "purple"]) {
      expect(run({ stored, systemLight: true }), String(stored)).toBe("light");
      expect(run({ stored, systemLight: false }), String(stored)).toBe("dark");
    }
  });

  it("never throws and always sets a theme, even with blocked storage or no matchMedia", () => {
    expect(run({ storageThrows: true, systemLight: true })).toBe("light");
    expect(run({ storageThrows: true, systemLight: false })).toBe("dark");
    expect(run({ matchMediaThrows: true })).toBe("dark");
    expect(run({ stored: "light", matchMediaThrows: true })).toBe("light");
    expect(run({ storageThrows: true, matchMediaThrows: true })).toBe("dark");
  });

  it("is ES5 text that is safe to inline in <head>", () => {
    expect(THEME_INIT_SCRIPT).not.toMatch(/=>|\blet\b|\bconst\b|`|<\/script/i);
  });
});

describe("the palettes", () => {
  it("dark is exactly the colors the UI always had (Tailwind's own), so nothing changed for dark-mode users", () => {
    expect(Object.keys(dark).length).toBeGreaterThan(15);
    for (const [name, rgb] of Object.entries(dark)) {
      const [family, shade] = name.split("-") as [string, string];
      const hex = (colors as unknown as Record<string, Record<string, string>>)[family]![shade]!;
      expect(rgb, name).toEqual(hexToRgb(hex));
    }
  });

  it("light defines every token that dark does, and nothing else", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it("the Tailwind config maps exactly the tokens the CSS defines", () => {
    const mapped = tailwind.theme!.extend!.colors as unknown as Record<string, Record<string, string>>;
    const names = Object.entries(mapped).flatMap(([family, shades]) => Object.keys(shades).map((s) => `${family}-${s}`));
    expect(names.sort()).toEqual(Object.keys(dark).sort());
    expect(mapped.zinc!["950"]).toBe("rgb(var(--c-zinc-950) / <alpha-value>)");
  });

  it("no color is hard-coded where the theme should decide", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    const layout = readFileSync(join(REPO, "src", "app", "layout.tsx"), "utf8");
    expect(layout).not.toContain('className="dark"');
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toContain("THEME_INIT_SCRIPT");
  });

  // WCAG AA: 4.5:1 for text. The page is zinc-950; a card is zinc-900 at 60% over it (bg-zinc-900/60).
  const themes: Array<[string, Record<string, Rgb>]> = [["dark", dark], ["light", light]];

  it.each(themes)("%s: text is readable on the page and on cards", (name, t) => {
    const page = t["zinc-950"]!;
    const card = over(t["zinc-900"]!, page, 0.6);
    // zinc-500 (hints) and zinc-600 (placeholders) in dark were already below AA before themes existed; pinned, not changed
    const floor: Record<string, number> = name === "dark" ? { "zinc-500": 3.8, "zinc-600": 2.4 } : { "zinc-600": 2.4 };
    for (const token of ["zinc-50", "zinc-100", "zinc-200", "zinc-300", "zinc-400", "zinc-500", "zinc-600", "indigo-300", "indigo-400", "emerald-300", "amber-300", "red-300", "red-400"]) {
      const min = floor[token] ?? 4.5;
      expect(contrast(t[token]!, page), `${name}: ${token} on the page`).toBeGreaterThanOrEqual(min);
      if (!token.startsWith("emerald-400")) expect(contrast(t[token]!, card), `${name}: ${token} on a card`).toBeGreaterThanOrEqual(min);
    }
  });

  it.each(themes)("%s: status badges, the active tab and the primary button are readable", (name, t) => {
    const page = t["zinc-950"]!;
    const tint = (rgb: Rgb) => over(rgb, page, 0.1); // border-x-500/30 bg-x-500/10
    expect(contrast(t["emerald-300"]!, tint([16, 185, 129])), `${name} ok badge`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["amber-300"]!, tint([245, 158, 11])), `${name} warn badge`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["red-300"]!, tint([239, 68, 68])), `${name} bad badge`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["indigo-300"]!, tint([99, 102, 241])), `${name} info badge`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["zinc-50"]!, over([79, 70, 229], page, 0.25)), `${name} active tab`).toBeGreaterThanOrEqual(4.5);
    expect(contrast([255, 255, 255], [79, 70, 229]), "white on indigo-600 (the same in both themes)").toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("%s: icons and borders that carry meaning reach 3:1", (name, t) => {
    const page = t["zinc-950"]!;
    for (const token of ["emerald-400", "amber-400", "indigo-400"]) expect(contrast(t[token]!, page), `${name}: ${token}`).toBeGreaterThanOrEqual(3);
  });

  it("light really is light and dark really is dark", () => {
    expect(luminance(light["zinc-950"]!)).toBeGreaterThan(0.9);
    expect(luminance(light["zinc-100"]!)).toBeLessThan(0.05);
    expect(luminance(dark["zinc-950"]!)).toBeLessThan(0.05);
    expect(luminance(dark["zinc-100"]!)).toBeGreaterThan(0.85);
  });
});

describe("the theme switch", () => {
  const html = renderToStaticMarkup(createElement(ThemeToggle));

  it("offers light, system and dark as a labelled group of buttons, with none shown as chosen until the browser says which is", () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Color theme"');
    for (const label of ["Light", "Match my system", "Dark"]) expect(html).toContain(`aria-label="${label}"`);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(0);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(3);
    expect((html.match(/<button/g) ?? []).length).toBe(3);
  });
});

describe("following the system while the page is open (a fake browser whose system setting the test can flip)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeBrowser(systemLight: boolean) {
    const store = new Map<string, string>();
    const media = Object.assign(new EventTarget(), { matches: systemLight });
    const win = new EventTarget() as EventTarget & Record<string, unknown>;
    win.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    win.matchMedia = () => media;
    let attribute: string | undefined;
    const doc = { documentElement: { setAttribute: (n: string, v: string) => void (n === "data-theme" && (attribute = v)) } };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    return {
      win,
      store,
      theme: () => attribute,
      setSystem(light: boolean) {
        media.matches = light;
        media.dispatchEvent(new Event("change"));
      },
    };
  }

  it("a choice is stored and applied; 'system' forgets the choice and follows the system", () => {
    const b = fakeBrowser(false);
    setThemeChoice("light");
    expect([b.theme(), b.store.get(THEME_KEY)]).toEqual(["light", "light"]);
    expect(readThemeChoice()).toBe("light");
    setThemeChoice("system");
    expect([b.theme(), b.store.has(THEME_KEY)]).toEqual(["dark", false]);
    expect(readThemeChoice()).toBe("system");
  });

  it("while following the system, the page changes when the system does, and tells the component", () => {
    const b = fakeBrowser(false);
    setThemeChoice("system");
    const changed = vi.fn();
    const stop = subscribeToTheme(changed);
    b.setSystem(true);
    expect(b.theme()).toBe("light");
    b.setSystem(false);
    expect(b.theme()).toBe("dark");
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
  });

  it("a chosen theme is not overridden by the system", () => {
    const b = fakeBrowser(false);
    setThemeChoice("dark");
    const stop = subscribeToTheme(() => {});
    b.setSystem(true);
    expect(b.theme()).toBe("dark");
    setThemeChoice("light");
    b.setSystem(false);
    expect(b.theme()).toBe("light");
    stop();
  });

  it("another tab's change arrives, and unrelated storage keys are ignored", () => {
    const b = fakeBrowser(false);
    const changed = vi.fn();
    const stop = subscribeToTheme(changed);
    b.store.set(THEME_KEY, "light");
    b.win.dispatchEvent(Object.assign(new Event("storage"), { key: THEME_KEY }));
    expect(b.theme()).toBe("light");
    expect(changed).toHaveBeenCalledTimes(1);
    b.win.dispatchEvent(Object.assign(new Event("storage"), { key: "something-else" }));
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });

  it("the change made in this tab reaches the component, and stopping the subscription really stops it", () => {
    const b = fakeBrowser(true);
    const changed = vi.fn();
    const stop = subscribeToTheme(changed);
    setThemeChoice("dark");
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    setThemeChoice("light");
    b.setSystem(false);
    b.win.dispatchEvent(new Event(THEME_EVENT));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("survives blocked storage: unreadable means 'system', and a choice still applies to this page", () => {
    const b = fakeBrowser(true);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    b.win.localStorage = blocked;
    expect(readThemeChoice()).toBe("system");
    expect(() => setThemeChoice("dark")).not.toThrow();
    expect(b.theme()).toBe("dark");
    b.store.set(THEME_KEY, "purple");
    b.win.localStorage = { getItem: (k: string) => b.store.get(k) ?? null };
    expect(readThemeChoice()).toBe("system");
  });
});
