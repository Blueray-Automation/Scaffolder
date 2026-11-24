import type { ScaffolderConfig, WebFramework } from "./config";

/**
 * What differs between the web frameworks that have a pack, in one place: the gate labels, the environment the
 * build and the running app need, how the facts stage starts the built app, and the words the generated docs use.
 * Everything else (install, lint, type-check, test, coverage) is the same `npm run <script>` in every pack.
 */
export interface WebStack {
  /** "Next.js" */
  name: string;
  /** "Next.js (App Router, TypeScript)": how README and AGENTS describe the app. */
  description: string;
  /** The file in `.ai/rules/` that holds this stack's conventions. */
  ruleFile: string;
  /** The type checker the type-check script runs. */
  typeTool: string;
  /** What the gates say they run. */
  labels: { types: string; build: string };
  /** Set for the production build (and for the app the facts stage starts). */
  env: Record<string, string>;
  /** Starts the built app on the given port, from the web directory: the command and its extra environment. */
  start: (port: number) => { cmd: string; env: Record<string, string> };
  /** The design contract, relative to the web directory: where the generated stylesheet of tokens goes, and the folder checked for hard-coded values. */
  design: { tokensCss: string; sourceDir: string };
}

const NEXTJS: WebStack = {
  name: "Next.js",
  description: "Next.js (App Router, TypeScript)",
  ruleFile: "web-nextjs.md",
  typeTool: "tsc",
  labels: { types: "Web type check (tsc)", build: "Web production build (next build)" },
  env: { NEXT_TELEMETRY_DISABLED: "1" },
  start: (port) => ({ cmd: `npm run start -- --port ${port} --hostname 127.0.0.1`, env: {} }),
  design: { tokensCss: "src/app/tokens.css", sourceDir: "src" },
};

const NUXT: WebStack = {
  name: "Nuxt",
  description: "Nuxt 4 (Vue 3, TypeScript)",
  ruleFile: "web-nuxt.md",
  typeTool: "vue-tsc",
  labels: { types: "Web type check (vue-tsc)", build: "Web production build (nuxt build)" },
  env: { NUXT_TELEMETRY_DISABLED: "1" },
  // The built server reads its address from these (it has no command-line flags).
  start: (port) => ({ cmd: "npm run start", env: { NITRO_PORT: String(port), NITRO_HOST: "127.0.0.1" } }),
  design: { tokensCss: "app/assets/css/tokens.css", sourceDir: "app" },
};

const STACKS: Partial<Record<WebFramework, WebStack>> = { nextjs: NEXTJS, nuxt: NUXT };

/**
 * The stack of the configured web framework. A framework without a pack never gets this far (validation rejects it
 * before anything is generated), so the fallback only keeps callers that skip validation from crashing.
 */
export function webStack(cfg: ScaffolderConfig): WebStack {
  return STACKS[cfg.web.framework] ?? NEXTJS;
}
