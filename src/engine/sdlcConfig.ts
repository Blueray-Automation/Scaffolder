import { AGENT_PRESETS, DESKTOP_APPS } from "./capabilities";
import { agentCommand, type ScaffolderConfig } from "./config";
import { mobileStack } from "./mobileStacks";
import { webStack } from "./webStacks";
import { buildGates, NPM_CI, NPM_INSTALL, setupSteps, STAGE_ORDER, venvDirs } from "./gates";

interface LocalService {
  name: string;
  cwd: string;
  cmd: string;
  env: Record<string, string>;
  pathPrepend: string[];
  healthUrl: string;
  startTimeoutSeconds: number;
}

/**
 * The `agent` section of `.ai/sdlc.json`: which agent runs, every agent a person may pick, the desktop apps, the prompt files.
 * Shared by generated and adopted projects. `command` is already resolved (an explicit command, else the preset's).
 */
export function buildAgentSection(
  agent: { preset: string; command: string; timeoutSeconds: number },
  /** Prompt files only some kinds of project have (an adopted project's `onboard`). */
  extraPrompts: Record<string, string> = {},
): Record<string, unknown> {
  return {
    preset: agent.preset,
    // Resolved: an explicit command wins, otherwise the preset's command (empty = human in the loop).
    command: agent.command,
    // Every agent the person may pick with `sdlc agent`, installed or not. Lives here, in the file the
    // agent may not edit, so choosing one can only ever select a command that was generated, never invent one.
    presets: AGENT_PRESETS.filter((p) => p.command).map((p) => ({
      id: p.id,
      label: p.label,
      mode: p.mode,
      command: p.command,
      program: p.program,
      install: p.install,
      docs: p.docs,
    })),
    // Desktop apps a person can hand the work to (`handoff:<id>` in a preset's command): how to open and find them.
    desktopApps: DESKTOP_APPS.map((a) => ({
      id: a.id,
      label: a.label,
      open: a.open,
      detect: a.detect,
      steps: a.steps,
      install: a.install,
      docs: a.docs,
    })),
    timeoutSeconds: agent.timeoutSeconds,
    prompts: {
      prd: ".ai/prompts/prd.md",
      spec: ".ai/prompts/spec.md",
      specFix: ".ai/prompts/spec-fix.md",
      implement: ".ai/prompts/implement.md",
      heal: ".ai/prompts/heal.md",
      ...extraPrompts,
    },
  };
}

/** Builds the machine-readable `.ai/sdlc.json` consumed by `scripts/sdlc.py`. */
export function buildSdlcConfig(cfg: ScaffolderConfig): Record<string, unknown> {
  const backendUrl = `http://127.0.0.1:${cfg.backend.port}`;
  const webUrl = `http://127.0.0.1:${cfg.web.port}`;
  const hasDb = cfg.backend.enabled && cfg.database.type !== "none";

  const targets: Record<string, string> = {};
  const localServices: LocalService[] = [];
  const dockerProvides: string[] = [];

  if (cfg.backend.enabled) {
    targets.backend = backendUrl;
    dockerProvides.push("backend");
    localServices.push({
      name: "backend",
      cwd: cfg.layout.backendDir,
      cmd: `uvicorn app.main:app --host 127.0.0.1 --port ${cfg.backend.port}`,
      // Local mode deliberately has no database: DB-dependent facts are skipped, not faked.
      env: { APP_ENV: "test", DATABASE_URL: "" },
      pathPrepend: venvDirs(cfg.layout.backendDir),
      healthUrl: `${backendUrl}/health`,
      startTimeoutSeconds: 60,
    });
  }
  if (cfg.web.enabled) {
    targets.web = webUrl;
    dockerProvides.push("web");
    const start = webStack(cfg).start(cfg.web.port);
    localServices.push({
      name: "web",
      cwd: cfg.layout.webDir,
      cmd: start.cmd,
      env: { ...(cfg.backend.enabled ? { API_URL: backendUrl } : {}), ...webStack(cfg).env, ...start.env },
      pathPrepend: [],
      healthUrl: `${webUrl}/`,
      startTimeoutSeconds: 90,
    });
  }
  if (hasDb) dockerProvides.push("db");

  return {
    version: 1,
    project: cfg.project.name,
    stages: STAGE_ORDER,
    loop: {
      maxIterations: cfg.sdlc.maxIterations,
      noProgressLimit: cfg.sdlc.noProgressLimit,
      failFast: cfg.sdlc.failFast,
    },
    agent: buildAgentSection({ preset: cfg.sdlc.agent.preset, command: agentCommand(cfg), timeoutSeconds: cfg.sdlc.agent.timeoutSeconds }),
    integrity: {
      // Verification machinery: the agent may never edit these (all phases).
      protected: [
        ".ai/sdlc.json",
        "scripts/sdlc",
        "scripts/sdlc.cmd",
        "scripts/sdlc.py",
        ".github/workflows/",
        ...cfg.sdlc.protectedPaths,
      ],
      // Requirements and checks: frozen while healing (healing fixes code, not the goalposts).
      protectedWhileHealing: [".ai/specs/"],
      // Allowed to change, but every change is listed in the evidence report for review.
      guarded: cfg.backend.enabled ? [".ai/contract/"] : [],
    },
    // Setup commands here are OS-neutral (they must run in sh, cmd.exe and PowerShell alike); CI uses the bash forms.
    // Python steps carry the minimum version and placeholders that `sdlc setup` fills in: {python} is an interpreter it
    // found (or offered to install) instead of failing with a raw pip error, {venv_python} is the venv's own interpreter
    // (.venv/bin/python, or .venv\Scripts\python.exe on Windows). Node steps pick `npm ci` or `npm install` by whether a lockfile exists.
    setup: setupSteps(cfg).map((step) => {
      if (step.toolchain === "python") {
        return {
          ...step,
          cmd: step.cmd.replace(/^python3 /, "{python} ").split(".venv/bin/python").join("{venv_python}"),
          minPython: cfg.backend.version,
        };
      }
      if (step.toolchain === "flutter") {
        // `tools` is what `sdlc doctor` looks for on PATH; the lockfile choice is made by the runner, like npm's.
        const { install, tool } = mobileStack(cfg);
        return { ...step, cmd: install.cmd, lockfile: install.lockfile, fallbackCmd: install.fallbackCmd, tools: [tool] };
      }
      return { ...step, cmd: NPM_CI, lockfile: "package-lock.json", fallbackCmd: NPM_INSTALL };
    }),
    gates: buildGates(cfg),
    runtime: {
      mode: cfg.sdlc.runtime,
      targets,
      docker: {
        composeFile: "docker-compose.yml",
        up: "docker compose up -d --build --wait",
        down: "docker compose down --volumes --remove-orphans",
        logs: "docker compose logs --no-color --tail=200",
        provides: dockerProvides,
      },
      local: {
        provides: [...(cfg.backend.enabled ? ["backend"] : []), ...(cfg.web.enabled ? ["web"] : [])],
        services: localServices,
      },
    },
    facts: {
      enabled: cfg.sdlc.gates.facts,
      specsDir: ".ai/specs",
      // true = a skipped check (missing capability) fails verification.
      strictSkips: false,
    },
    deploy: {
      target: cfg.cd.target,
      script: "scripts/deploy.sh",
      environments: cfg.cd.environments.map((e) => ({ name: e.name, url: e.url })),
    },
  };
}
