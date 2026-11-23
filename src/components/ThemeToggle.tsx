"use client";

import React, { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cx } from "@/lib/utils";
import { readThemeChoice, setThemeChoice, subscribeToTheme, THEME_CHOICES, type ThemeChoice } from "@/lib/theme";

const OPTIONS: Record<ThemeChoice, { label: string; icon: React.ReactNode }> = {
  light: { label: "Light", icon: <Sun className="h-3.5 w-3.5" aria-hidden /> },
  system: { label: "Match my system", icon: <Monitor className="h-3.5 w-3.5" aria-hidden /> },
  dark: { label: "Dark", icon: <Moon className="h-3.5 w-3.5" aria-hidden /> },
};

/**
 * Light / follow the system / dark. The server cannot know the reader's choice, so until the page is in the browser nothing is shown as selected:
 * a wrong guess would flash (and read out) a choice nobody made.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore<ThemeChoice | null>(subscribeToTheme, readThemeChoice, () => null);
  return (
    <div role="group" aria-label="Color theme" className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
      {THEME_CHOICES.map((id) => {
        const selected = choice === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            aria-label={OPTIONS[id].label}
            title={OPTIONS[id].label}
            onClick={() => setThemeChoice(id)}
            className={cx(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
              selected ? "bg-indigo-600/25 text-zinc-50" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
            )}
          >
            {OPTIONS[id].icon}
          </button>
        );
      })}
    </div>
  );
}
