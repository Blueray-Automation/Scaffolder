import { AGENT_PRESETS, findOption } from "../capabilities";
import { deepMerge, sanitizeName, type AgentPreset, type Issue, type RuntimeMode } from "../config";
import { STAGE_ORDER } from "../gates";
import type { Detection, GateStage } from "./detect";

/**
 * Settings for adopting an existing repository. Everything has a default taken from what detection found, so the file
 * is optional: it exists to change a decision (drop a gate, add one for a stack we cannot detect, declare how to run the
 * app for facts), not to describe the project.
 */

export const ADOPT_CONFIG_VERSION = 1;

export interface AdoptGateInput {
  id: string;
  label: string;
  stage: GateStage;
  cwd?: string;
  cmd: string;
  required?: boolean;
  timeoutSeconds?: number;
  env?: Record<string, string>;
  pathPrepend?: string[];
}

export interface AdoptService {
  name: string;
  /** Working directory relative to the repository root. */
  cwd: string;
  cmd: string;
  env: Record<string, string>;
  pathPrepend: string[];
  healthUrl: string;
  startTimeoutSeconds: number;
}

export interface AdoptConfig {
  version: number;
  project: { name: string; description: string };
  sdlc: {
    maxIterations: number;
    noProgressLimit: number;
    failFast: boolean;
    agent: { preset: AgentPreset; command: string; timeoutSeconds: number };
    /** Extra files/dirs the agent may never modify (added to the built-in set). */
    protectedPaths: string[];
    /** Extra files/dirs the agent may change but every change is listed for review (added to the detected configs). */
    guardedPaths: string[];
  };
  gates: {
    /** Detected gate ids to leave out. */
    exclude: string[];
    /** Gates for what detection cannot see. */
    add: AdoptGateInput[];
  };
  runtime: {
    /** "none" = facts are `cmd`/`file` checks; "local" starts `local.services`; "docker" runs the compose file. */
    mode: RuntimeMode;
    /** Capability name -> base URL, e.g. `web: http://127.0.0.1:3000`. */
    targets: Record<string, string>;
    local: { services: AdoptService[] };
    docker: { composeFile: string; provides: string[] };
  };
  /** `agents-block`: add a marked pointer block to AGENTS.md. `none`: write nothing outside `.ai/`. */
  rootFile: "agents-block" | "none";
}

export function defaultAdoptConfig(detection: Detection): AdoptConfig {
  return {
    version: ADOPT_CONFIG_VERSION,
    project: { name: detection.name, description: "" },
    sdlc: {
      maxIterations: 5,
      noProgressLimit: 2,
      failFast: true,
      agent: { preset: "claude", command: "", timeoutSeconds: 900 },
      protectedPaths: [],
      guardedPaths: [],
    },
    gates: { exclude: [], add: [] },
    runtime: {
      mode: "none",
      targets: {},
      local: { services: [] },
      docker: { composeFile: detection.existing.compose[0] ?? "docker-compose.yml", provides: [] },
    },
    rootFile: "agents-block",
  };
}

export function resolveAdoptConfig(input: unknown, detection: Detection): AdoptConfig {
  const merged = deepMerge(defaultAdoptConfig(detection), input);
  // A folder called "x" or a 80-character name is still adoptable: the name only labels reports and the compose project.
  let name = sanitizeName(String(merged.project.name)).slice(0, 49).replace(/-+$/, "");
  if (name.length < 2) name = `${name || "my"}-app`;
  merged.project.name = name;
  return merged;
}

const RELATIVE_DIR = /^(\.|[A-Za-z0-9_][A-Za-z0-9._/-]*)$/;
const GATE_ID = /^[a-z][a-z0-9.-]*$/;

export function validateAdoptConfig(cfg: AdoptConfig, detection: Detection): Issue[] {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ level: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ level: "warning", path, message });

  if (cfg.version !== ADOPT_CONFIG_VERSION) {
    err("version", `Unsupported adopt config version ${cfg.version}; this engine understands ${ADOPT_CONFIG_VERSION}.`);
  }
  if (!/^[a-z][a-z0-9-]{1,48}$/.test(cfg.project.name)) {
    err("project.name", "Must be 2-49 chars: lowercase letters, digits and dashes, starting with a letter.");
  }

  const s = cfg.sdlc;
  if (!Number.isInteger(s.maxIterations) || s.maxIterations < 1 || s.maxIterations > 20) {
    err("sdlc.maxIterations", "Must be an integer between 1 and 20.");
  }
  if (!Number.isInteger(s.noProgressLimit) || s.noProgressLimit < 1 || s.noProgressLimit > 10) {
    err("sdlc.noProgressLimit", "Must be an integer between 1 and 10.");
  }
  if (!Number.isInteger(s.agent.timeoutSeconds) || s.agent.timeoutSeconds < 30 || s.agent.timeoutSeconds > 7200) {
    err("sdlc.agent.timeoutSeconds", "Must be between 30 and 7200 seconds.");
  }
  if (s.agent.command && /[\r\n]/.test(s.agent.command)) err("sdlc.agent.command", "Must be a single-line shell command.");
  if (!findOption(AGENT_PRESETS, s.agent.preset)) {
    err("sdlc.agent.preset", `Unknown agent preset "${s.agent.preset}". Choose one of: ${AGENT_PRESETS.map((p) => p.id).join(", ")}.`);
  } else if (s.agent.preset === "custom" && !s.agent.command.trim()) {
    err("sdlc.agent.command", 'Preset "custom" needs a command that reads the prompt on stdin.');
  }
  for (const [path, list] of [["sdlc.protectedPaths", s.protectedPaths], ["sdlc.guardedPaths", s.guardedPaths]] as const) {
    list.forEach((p, i) => {
      if (typeof p !== "string" || !p || p.startsWith("/") || p.includes("..")) err(`${path}[${i}]`, "Must be a path relative to the repository root, without '..'.");
    });
  }

  const known = new Set(detection.gates.map((g) => g.id));
  cfg.gates.exclude.forEach((id, i) => {
    if (!known.has(id)) warn(`gates.exclude[${i}]`, `"${id}" is not a detected gate (detected: ${[...known].join(", ") || "none"}).`);
  });
  const taken = new Set(known);
  cfg.gates.add.forEach((g, i) => {
    const at = `gates.add[${i}]`;
    if (!GATE_ID.test(g.id ?? "")) err(`${at}.id`, "Use lowercase letters, digits, dots and dashes, starting with a letter (e.g. go.test).");
    else if (taken.has(g.id)) err(`${at}.id`, `"${g.id}" is already a gate id.`);
    taken.add(g.id);
    // "facts" is a stage of the loop but not something a shell gate can be (the specs drive it).
    if (!STAGE_ORDER.includes(g.stage) || (g.stage as string) === "facts") err(`${at}.stage`, `Must be one of: ${STAGE_ORDER.filter((x) => x !== "facts").join(", ")}.`);
    if (typeof g.cmd !== "string" || !g.cmd.trim()) err(`${at}.cmd`, "A gate needs the command to run.");
    if (g.cwd !== undefined && (!RELATIVE_DIR.test(g.cwd) || g.cwd.includes(".."))) err(`${at}.cwd`, "Must be a relative folder without '..' ('.' for the root).");
    if (!g.label) err(`${at}.label`, "A gate needs a label.");
  });

  const r = cfg.runtime;
  if (r.mode === "local") {
    if (r.local.services.length === 0) err("runtime.local.services", 'Runtime "local" needs at least one service to start.');
    r.local.services.forEach((svc, i) => {
      const at = `runtime.local.services[${i}]`;
      if (!svc.name || !svc.cmd) err(at, "A service needs a name and a command.");
      try {
        new URL(svc.healthUrl);
      } catch {
        err(`${at}.healthUrl`, "Must be an absolute URL that answers 2xx/3xx once the service is up.");
      }
    });
  }
  if (r.mode === "docker") {
    if (!detection.existing.compose.includes(r.docker.composeFile)) {
      err("runtime.docker.composeFile", `Runtime "docker" needs a compose file in the repository (found: ${detection.existing.compose.join(", ") || "none"}).`);
    }
    if (r.docker.provides.length === 0) err("runtime.docker.provides", "List which capabilities the compose stack provides (e.g. web, backend, db).");
  }
  if (r.mode !== "none") {
    for (const [name, url] of Object.entries(r.targets)) {
      try {
        new URL(url);
      } catch {
        err(`runtime.targets.${name}`, "Must be an absolute URL.");
      }
    }
  }

  if (cfg.rootFile !== "agents-block" && cfg.rootFile !== "none") err("rootFile", 'Must be "agents-block" or "none".');
  if (detection.gates.filter((g) => !cfg.gates.exclude.includes(g.id)).length + cfg.gates.add.length === 0) {
    warn("gates", "The project starts with no gates: `verify` can only check feature specs. Add gates (gates.add) or the scripts they would run.");
  }
  return issues;
}
