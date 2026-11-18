import type { ScaffolderConfig } from "./config";

/**
 * Gates are the unit of verification. They are defined ONCE here and emitted
 * into (a) .ai/sdlc.json, which the local loop executes, and (b) the CI
 * workflow, so a green local `verify` and a green pipeline mean the same thing.
 */

export type Stage = "static" | "unit" | "build" | "contract" | "facts" | "security";

export const STAGE_ORDER: Stage[] = ["static", "unit", "build", "contract", "facts", "security"];

export type Component = "backend" | "web" | "repo";

export interface Gate {
  id: string;
  label: string;
  stage: Exclude<Stage, "facts">;
  component: Component;
  /** Working directory relative to the repo root ("." for root). */
  cwd: string;
  cmd: string;
  /** A failing non-required gate is reported as a warning, not a failure. */
  required: boolean;
  timeoutSeconds: number;
  env?: Record<string, string>;
  /** Directories (relative to repo root) prepended to PATH, e.g. a venv. */
  pathPrepend?: string[];
}

export interface SetupStep {
  id: string;
  label: string;
  component: Exclude<Component, "repo">;
  cwd: string;
  cmd: string;
  toolchain: "python" | "node";
  /** Files whose change means dependencies must be reinstalled (`sdlc sync`). */
  manifests: string[];
  /** If this path is missing the step has never run (e.g. the venv or node_modules). */
  marker: string;
}

/** Relative path from directory `from` (repo-relative) to repo-relative `to`. */
export function relativeFrom(from: string, to: string): string {
  const depth = from === "." ? 0 : from.split("/").filter(Boolean).length;
  return depth === 0 ? to : `${"../".repeat(depth)}${to}`;
}

export const OPENAPI_SNAPSHOT = ".ai/contract/openapi.json";

export function setupSteps(cfg: ScaffolderConfig): SetupStep[] {
  const steps: SetupStep[] = [];
  if (cfg.backend.enabled) {
    steps.push({
      id: "backend.install",
      label: "Install backend dependencies (venv)",
      component: "backend",
      cwd: cfg.layout.backendDir,
      toolchain: "python",
      manifests: [`${cfg.layout.backendDir}/pyproject.toml`],
      marker: `${cfg.layout.backendDir}/.venv`,
      cmd: 'python3 -m venv --clear .venv && .venv/bin/python -m pip install --quiet --upgrade pip && .venv/bin/pip install --quiet -e ".[dev]"',
    });
  }
  if (cfg.web.enabled) {
    steps.push({
      id: "web.install",
      label: "Install web dependencies",
      component: "web",
      cwd: cfg.layout.webDir,
      toolchain: "node",
      manifests: [`${cfg.layout.webDir}/package.json`],
      marker: `${cfg.layout.webDir}/node_modules`,
      cmd: "if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi",
    });
  }
  return steps;
}

export function buildGates(cfg: ScaffolderConfig): Gate[] {
  const g = cfg.sdlc.gates;
  const gates: Gate[] = [];
  const backendDir = cfg.layout.backendDir;
  const webDir = cfg.layout.webDir;
  const venv = [`${backendDir}/.venv/bin`];

  if (cfg.backend.enabled) {
    if (g.lint) {
      gates.push({
        id: "backend.lint",
        label: "Backend lint & format (ruff)",
        stage: "static",
        component: "backend",
        cwd: backendDir,
        cmd: "ruff check . && ruff format --check .",
        required: true,
        timeoutSeconds: 300,
        pathPrepend: venv,
      });
    }
    if (g.types) {
      gates.push({
        id: "backend.types",
        label: "Backend type check (mypy)",
        stage: "static",
        component: "backend",
        cwd: backendDir,
        cmd: "mypy app",
        required: true,
        timeoutSeconds: 600,
        pathPrepend: venv,
      });
    }
    if (g.unit) {
      gates.push({
        id: "backend.unit",
        label: `Backend unit tests (pytest, coverage >= ${cfg.sdlc.coverage.backend}%)`,
        stage: "unit",
        component: "backend",
        cwd: backendDir,
        cmd: `pytest -q --cov=app --cov-report=term-missing:skip-covered --cov-fail-under=${cfg.sdlc.coverage.backend}`,
        required: true,
        timeoutSeconds: 900,
        pathPrepend: venv,
      });
    }
    if (g.contract) {
      gates.push({
        id: "backend.contract",
        label: "API contract matches committed OpenAPI snapshot",
        stage: "contract",
        component: "backend",
        cwd: backendDir,
        cmd: `python -m app.export_openapi --check ${relativeFrom(backendDir, OPENAPI_SNAPSHOT)}`,
        required: true,
        timeoutSeconds: 120,
        pathPrepend: venv,
      });
    }
    if (g.security) {
      gates.push({
        id: "backend.audit",
        label: "Backend dependency audit (pip-audit)",
        stage: "security",
        component: "backend",
        cwd: backendDir,
        cmd: "pip-audit --skip-editable --progress-spinner off",
        required: false,
        timeoutSeconds: 600,
        pathPrepend: venv,
      });
    }
  }

  if (cfg.web.enabled) {
    if (g.lint) {
      gates.push({
        id: "web.lint",
        label: "Web lint (eslint)",
        stage: "static",
        component: "web",
        cwd: webDir,
        cmd: "npm run lint",
        required: true,
        timeoutSeconds: 300,
      });
    }
    if (g.types) {
      gates.push({
        id: "web.types",
        label: "Web type check (tsc)",
        stage: "static",
        component: "web",
        cwd: webDir,
        cmd: "npm run type-check",
        required: true,
        timeoutSeconds: 300,
      });
    }
    if (g.unit) {
      gates.push({
        id: "web.unit",
        label: `Web unit tests (vitest, coverage >= ${cfg.sdlc.coverage.web}%)`,
        stage: "unit",
        component: "web",
        cwd: webDir,
        cmd: "npm run test:coverage",
        required: true,
        timeoutSeconds: 600,
      });
    }
    if (g.build) {
      gates.push({
        id: "web.build",
        label: "Web production build (next build)",
        stage: "build",
        component: "web",
        cwd: webDir,
        cmd: "npm run build",
        required: true,
        timeoutSeconds: 900,
        env: { NEXT_TELEMETRY_DISABLED: "1" },
      });
    }
    if (g.security) {
      gates.push({
        id: "web.audit",
        label: "Web dependency audit (npm audit)",
        stage: "security",
        component: "web",
        cwd: webDir,
        cmd: "npm audit --audit-level=high",
        required: false,
        timeoutSeconds: 300,
      });
    }
  }

  if (cfg.docker.enabled && g.build) {
    gates.push({
      id: "docker.compose-valid",
      label: "docker-compose.yml is valid",
      stage: "build",
      component: "repo",
      cwd: ".",
      cmd: "docker compose config --quiet",
      required: cfg.sdlc.runtime === "docker",
      timeoutSeconds: 60,
    });
  }

  if (g.security) {
    gates.push({
      id: "repo.secrets",
      label: "No secrets committed (built-in scan)",
      stage: "security",
      component: "repo",
      cwd: ".",
      cmd: "python3 scripts/sdlc.py secrets",
      required: true,
      timeoutSeconds: 120,
    });
  }

  const order = (s: Gate["stage"]) => STAGE_ORDER.indexOf(s);
  return gates.sort((a, b) => order(a.stage) - order(b.stage));
}
