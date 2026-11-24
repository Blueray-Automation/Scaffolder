import { CAPABILITIES, findOption } from "./capabilities";
import {
  defaultConfig,
  deepMerge,
  validateConfig,
  type DatabaseType,
  type MobileFramework,
  type ScaffolderConfig,
  type WebFramework,
} from "./config";

/** What a project is made of. Everything else (names, ports, CI, the verification loop) is left alone by a preset. */
interface Stack {
  api?: boolean;
  web?: WebFramework;
  mobile?: MobileFramework;
  db?: DatabaseType;
}

export interface Preset {
  id: string;
  /** Short enough for a tab. */
  label: string;
  hint: string;
  stack: Stack;
}

/**
 * The "Start from" choices. A preset is only a stack shape: whether it can be generated is not stored here but asked of
 * the validator (`presetProblems`), so it becomes selectable the moment its pack exists, with nothing here to flip.
 */
export const PRESETS: Preset[] = [
  { id: "fullstack", label: "Full-stack", hint: "FastAPI + Next.js + PostgreSQL", stack: { api: true, web: "nextjs", db: "postgres" } },
  { id: "api", label: "API + database", hint: "FastAPI + PostgreSQL", stack: { api: true, db: "postgres" } },
  { id: "api-lite", label: "API only", hint: "FastAPI, no database", stack: { api: true } },
  { id: "nextjs", label: "Next.js", hint: "A Next.js web app on its own, no separate API", stack: { web: "nextjs" } },
  { id: "nuxt", label: "Nuxt", hint: "A Nuxt (Vue) web app on its own, no separate API", stack: { web: "nuxt" } },
  { id: "flutter", label: "Flutter", hint: "A Flutter mobile app on its own, no separate API", stack: { mobile: "flutter" } },
  { id: "android", label: "Android", hint: "A native Android app on its own, no separate API", stack: { mobile: "android" } },
  { id: "ios", label: "iOS", hint: "A native iOS app on its own, no separate API", stack: { mobile: "ios" } },
];

/** Spells out every part of the stack, so applying a preset gives the same shape whatever the config was before. */
function stackPatch(s: Stack) {
  return {
    backend: { enabled: Boolean(s.api) },
    web: s.web ? { enabled: true, framework: s.web } : { enabled: false },
    mobile: s.mobile ? { enabled: true, framework: s.mobile } : { enabled: false },
    database: { type: s.db ?? "none" },
  };
}

/** Switch the stack to the preset's and keep everything else the user set (project name, ports, CI/CD, agent...). */
export function applyPreset(base: ScaffolderConfig, preset: Preset): ScaffolderConfig {
  const next = deepMerge(base, stackPatch(preset.stack));
  const db = findOption(CAPABILITIES.database, next.database.type);
  if (db?.versions && !db.versions.includes(next.database.version)) next.database.version = db.versions[0];
  const mobile = findOption(CAPABILITIES.mobile.frameworks, next.mobile.framework);
  if (mobile?.versions[0] && !mobile.versions.includes(next.mobile.version)) next.mobile.version = mobile.versions[0];
  return next;
}

/** Why the preset cannot be generated yet. Empty = it can. */
export function presetProblems(preset: Preset): string[] {
  return validateConfig(applyPreset(defaultConfig(), preset))
    .filter((i) => i.level === "error")
    .map((i) => i.message);
}

function shapeKey(cfg: ScaffolderConfig): string {
  return [
    cfg.backend.enabled ? "api" : "",
    cfg.web.enabled ? cfg.web.framework : "",
    cfg.mobile.enabled ? cfg.mobile.framework : "",
    cfg.database.type,
  ].join("|");
}

/** The preset whose stack this config has, or undefined for anything else (the user changed the stack by hand). */
export function detectPreset(cfg: ScaffolderConfig): Preset | undefined {
  const key = shapeKey(cfg);
  return PRESETS.find((p) => shapeKey(applyPreset(defaultConfig(), p)) === key);
}
