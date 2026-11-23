import type { Config } from "tailwindcss";

/**
 * The colors the UI uses are theme tokens: `bg-zinc-950` means "the page background" and `text-zinc-100` "the main text"
 * in both themes. The numbers are kept in CSS variables (src/app/globals.css) as space-separated RGB, so the same classes
 * give the dark look (the original Tailwind values) or the light one, with opacity modifiers (`bg-zinc-900/60`) still working.
 * Shades that are used as fills and borders (indigo 500/600, the 500s) look right in both themes and stay Tailwind's own.
 */
const token = (family: string, shade: number) => `rgb(var(--c-${family}-${shade}) / <alpha-value>)`;
const scale = (family: string, shades: number[]) => Object.fromEntries(shades.map((s) => [s, token(family, s)]));

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // `dark:` variants follow the theme switch (the data-theme attribute), not only the operating system
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        zinc: scale("zinc", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        indigo: scale("indigo", [200, 300, 400]),
        emerald: scale("emerald", [300, 400]),
        amber: scale("amber", [300, 400]),
        red: scale("red", [300, 400]),
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
