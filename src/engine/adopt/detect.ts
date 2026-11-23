import type { Stage } from "../gates";

/**
 * Detection: what an existing repository already has, so the `.ai/` overlay can adopt its own commands instead of
 * imposing a stack. Pure: it reads a snapshot (a list of paths and a way to read text files), never the disk, so it runs
 * unchanged in the CLI, the tests and (later) the browser.
 *
 * The rule that keeps it honest: a gate is only proposed when the repository itself defines the command (a script in
 * package.json, a tool section in pyproject.toml, a Makefile target) and it says where it found it (`evidence`).
 * Everything it could not wire ends up in `notCovered`; nothing is guessed to make the list look complete.
 */

export type GateStage = Exclude<Stage, "facts">;

export interface RepoSnapshot {
  /** The repository folder's name: the fallback project name. */
  name: string;
  /** Every file in the repository (posix paths relative to its root) except dependency, build and VCS folders. */
  paths: string[];
  /** The text of a file, or undefined when it does not exist or is too large to read. */
  read(path: string): string | undefined;
}

export function snapshotFromFiles(files: Record<string, string>, name = "my-repo"): RepoSnapshot {
  return { name, paths: Object.keys(files).sort(), read: (path) => files[path] };
}

export interface DetectedGate {
  id: string;
  label: string;
  stage: GateStage;
  /** Working directory relative to the repository root ("." for the root). */
  cwd: string;
  cmd: string;
  required: boolean;
  timeoutSeconds: number;
  env?: Record<string, string>;
  /** Directories (relative to the repository root) prepended to PATH, e.g. a virtual environment. */
  pathPrepend?: string[];
  component: string;
  /** Where the repository defines this command, e.g. `package.json scripts.lint`. */
  evidence: string;
}

export interface DetectedSetup {
  id: string;
  label: string;
  component: string;
  cwd: string;
  cmd: string;
  toolchain: "python" | "node";
  /** Files whose change means dependencies must be reinstalled. */
  manifests: string[];
  /** If this path exists the dependencies are already installed (the tool then records that instead of reinstalling). */
  marker: string;
  /** Programs the step needs on PATH (`doctor` checks them). */
  tools: string[];
  lockfile?: string;
  fallbackCmd?: string;
  /** Minimum Python for creating a virtual environment (only when one has to be created). */
  minPython?: string;
  /** Name of the virtual environment folder that `{venv_python}` refers to. */
  venv?: string;
  /** An environment that already exists is adopted as it is, never reinstalled or wiped. */
  trustExisting: true;
}

export interface DetectedComponent {
  id: string;
  dir: string;
  kind: "node" | "python" | "make";
  /** One line for the report: the tool, and which gates it supports. */
  summary: string;
}

export interface Detection {
  /** Best guess for the project's name (package.json / pyproject.toml / folder). */
  name: string;
  components: DetectedComponent[];
  gates: DetectedGate[];
  setup: DetectedSetup[];
  /** Existing configuration files that define "correct" (lint, types, tests): changes are allowed but listed for review. */
  guardedPaths: string[];
  /** Programs the gates and setup steps run (node, pnpm, uv, make ...): `doctor` checks that they are installed. */
  tools: string[];
  existing: {
    /** Instruction files for AI tools that are already in the repository (AGENTS.md, CLAUDE.md, .cursor/rules, ...). */
    agentFiles: string[];
    aiFiles: string[];
    ci: string[];
    compose: string[];
    openapi: string[];
  };
  /** Things the repository has that this version does not wire up, in plain words. */
  notCovered: string[];
  /** Things worth enabling by hand (e.g. a start script that could run the facts against the live app). */
  suggestions: string[];
}

// --------------------------------------------------------------------------- helpers

/** Folders that never hold the project's own code (or only hold copies of it). */
const SKIP_SEGMENTS = new Set(["node_modules", "examples", "example", "fixtures", "__fixtures__", "templates", "docs", "dist", "build", ".next", "vendor", "third_party"]);

const MAX_DEPTH = 3;
const MAX_COMPONENTS = 12;

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "." : path.slice(0, i);
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function inDir(dir: string, name: string): string {
  return dir === "." ? name : `${dir}/${name}`;
}

function depthOf(dir: string): number {
  return dir === "." ? 0 : dir.split("/").length;
}

function skipped(dir: string): boolean {
  return dir.split("/").some((s) => SKIP_SEGMENTS.has(s));
}

function slugOf(dir: string, fallback: string): string {
  const slug = dir === "." ? fallback : dir.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

class Repo {
  readonly files: Set<string>;
  constructor(readonly snap: RepoSnapshot) {
    this.files = new Set(snap.paths);
  }
  exists(path: string): boolean {
    return this.files.has(path);
  }
  read(path: string): string | undefined {
    return this.files.has(path) ? this.snap.read(path) : undefined;
  }
  /** Direct children (files) of a directory. */
  filesIn(dir: string): string[] {
    return this.snap.paths.filter((p) => dirOf(p) === dir);
  }
  /** Directories that directly contain a file with this exact name. */
  dirsWith(name: string): string[] {
    return this.snap.paths.filter((p) => baseOf(p) === name).map(dirOf);
  }
}

/** A tiny id allocator: two folders may produce the same slug (`api` in two places). */
class Ids {
  private used = new Set<string>();
  take(base: string): string {
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`;
    this.used.add(id);
    return id;
  }
}

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// --------------------------------------------------------------------------- Node

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface ManagerInfo {
  id: PackageManager;
  lockfile: string;
  frozen: string;
  plain: string;
}

function managerFor(repo: Repo, dir: string, pkg: Record<string, unknown>): ManagerInfo {
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : "";
  const has = (name: string) => repo.exists(inDir(dir, name)) || (dir !== "." && repo.exists(name));
  const berry = repo.exists(inDir(dir, ".yarnrc.yml")) || repo.exists(".yarnrc.yml");
  if (declared === "pnpm" || (!declared && has("pnpm-lock.yaml"))) {
    return { id: "pnpm", lockfile: "pnpm-lock.yaml", frozen: "pnpm install --frozen-lockfile", plain: "pnpm install" };
  }
  if (declared === "yarn" || (!declared && has("yarn.lock"))) {
    return { id: "yarn", lockfile: "yarn.lock", frozen: berry ? "yarn install --immutable" : "yarn install --frozen-lockfile", plain: "yarn install" };
  }
  if (declared === "bun" || (!declared && (has("bun.lockb") || has("bun.lock")))) {
    return { id: "bun", lockfile: has("bun.lock") ? "bun.lock" : "bun.lockb", frozen: "bun install --frozen-lockfile", plain: "bun install" };
  }
  return { id: "npm", lockfile: "package-lock.json", frozen: "npm ci --no-audit --no-fund", plain: "npm install --no-audit --no-fund" };
}

/** Script names that count for each gate, in order of preference. */
const NODE_SCRIPTS: Array<{ gate: string; stage: GateStage; label: string; names: string[]; timeout: number }> = [
  { gate: "lint", stage: "static", label: "Lint", names: ["lint:ci", "lint"], timeout: 300 },
  { gate: "format", stage: "static", label: "Format check", names: ["format:check", "prettier:check", "check-format"], timeout: 300 },
  { gate: "types", stage: "static", label: "Type check", names: ["typecheck", "type-check", "check-types", "types", "tsc"], timeout: 300 },
  { gate: "test", stage: "unit", label: "Tests", names: ["test:ci", "test", "test:unit"], timeout: 900 },
  { gate: "build", stage: "build", label: "Build", names: ["build"], timeout: 900 },
];

const NODE_CONFIG = /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.[a-z]+)?|tsconfig(\.[\w-]+)?\.json|jest\.config\.[\w]+|vitest\.config\.[\w]+|vitest\.workspace\.[\w]+|\.prettierrc(\.[a-z]+)?|prettier\.config\.[\w]+|\.babelrc(\.[a-z]+)?|babel\.config\.[\w]+)$/;

function runScript(pm: PackageManager, script: string): string {
  return `${pm} run ${script}`;
}

function detectNode(repo: Repo, dir: string, ids: Ids, out: Detection, notes: { workspaceRoot: boolean }): void {
  const manifest = inDir(dir, "package.json");
  const pkg = parseJson(repo.read(manifest));
  if (!pkg) {
    out.notCovered.push(`${manifest} could not be read as JSON, so its scripts were not wired.`);
    return;
  }
  const scripts = asRecord(pkg.scripts);
  const pm = managerFor(repo, dir, pkg);
  const id = ids.take(slugOf(dir, "node"));
  const found: string[] = [];
  out.tools.push("node", pm.id);

  for (const spec of NODE_SCRIPTS) {
    const name = spec.names.find((n) => typeof scripts[n] === "string");
    if (!name) continue;
    const body = String(scripts[name]);
    if (spec.gate === "test" && /no test specified/i.test(body)) {
      out.notCovered.push(`${manifest}: scripts.${name} is the npm placeholder ("no test specified"), so there is no test gate. Add tests, or add a gate by hand.`);
      continue;
    }
    if (/--watch(All)?\b/.test(body)) {
      out.notCovered.push(`${manifest}: scripts.${name} runs in watch mode (\`${body}\`), which never ends, so it was not made a gate. Add a one-shot script and re-run adopt.`);
      continue;
    }
    found.push(spec.gate);
    out.gates.push({
      id: `${id}.${spec.gate}`,
      label: `${spec.label} (${pm.id} run ${name}${dir === "." ? "" : ` in ${dir}`})`,
      stage: spec.stage,
      cwd: dir,
      cmd: runScript(pm.id, name),
      required: true,
      timeoutSeconds: spec.timeout,
      ...(spec.gate === "test" ? { env: { CI: "true" } } : {}),
      component: id,
      evidence: `${manifest} scripts.${name}: ${body.length > 80 ? `${body.slice(0, 77)}...` : body}`,
    });
  }

  const dependencies = Object.keys(asRecord(pkg.dependencies)).length + Object.keys(asRecord(pkg.devDependencies)).length;
  if (found.length === 0 && dependencies === 0) return;
  out.components.push({
    id,
    dir,
    kind: "node",
    summary: `${pm.id}${notes.workspaceRoot ? " workspace root" : ""}: ${found.length > 0 ? found.join(", ") : "no lint/test/build script"}`,
  });
  if (found.length === 0) {
    out.notCovered.push(`${manifest} has no lint, type-check, test or build script, so it contributes no gate.`);
  }

  if (dependencies > 0) {
    out.setup.push({
      id: `${id}.install`,
      label: `Install ${dir === "." ? "" : `${dir} `}dependencies (${pm.id})`.replace("  ", " "),
      component: id,
      cwd: dir,
      cmd: pm.frozen,
      toolchain: "node",
      manifests: [manifest],
      marker: inDir(dir, "node_modules"),
      tools: pm.id === "npm" ? ["node", "npm"] : ["node", pm.id],
      lockfile: pm.lockfile,
      fallbackCmd: pm.plain,
      trustExisting: true,
    });
  }

  for (const file of repo.filesIn(dir)) {
    if (NODE_CONFIG.test(baseOf(file))) out.guardedPaths.push(file);
  }
  const startScript = ["start", "dev", "serve"].find((n) => typeof scripts[n] === "string");
  if (startScript && found.length > 0) {
    out.suggestions.push(
      `${manifest} has scripts.${startScript}: to check the PRD against the running app, declare it under runtime.local.services in your adopt config (see .ai/README.md, "Run the app for facts").`,
    );
  }
}

// --------------------------------------------------------------------------- Python

const PYTHON_CONFIG = /^(pytest\.ini|tox\.ini|setup\.cfg|mypy\.ini|\.mypy\.ini|ruff\.toml|\.ruff\.toml|\.flake8|\.coveragerc|conftest\.py)$/;
const REQUIREMENT_FILES = /^requirements([-_.][\w.-]+)?\.txt$|^(dev|test)-requirements\.txt$|^requirements\/[\w.-]+\.txt$/;

function toolMentioned(text: string, tool: string): boolean {
  return new RegExp(`(^|[^\\w-])${tool}(?![\\w-])`, "im").test(text);
}

function optionalExtras(pyproject: string): string[] {
  const start = pyproject.search(/^\[project\.optional-dependencies\]\s*$/m);
  if (start < 0) return [];
  const rest = pyproject.slice(start).split("\n").slice(1);
  const keys: string[] = [];
  for (const line of rest) {
    if (/^\[/.test(line)) break;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

function detectPython(repo: Repo, dir: string, ids: Ids, out: Detection): void {
  const here = repo.filesIn(dir);
  const pyprojectPath = inDir(dir, "pyproject.toml");
  const pyproject = repo.read(pyprojectPath) ?? "";
  const requirementFiles = here.filter((f) => REQUIREMENT_FILES.test(baseOf(f)));
  const nested = repo.snap.paths.filter((p) => dirOf(p) === inDir(dir, "requirements") && REQUIREMENT_FILES.test(`requirements/${baseOf(p)}`));
  // The base requirements first, then the others (dev, test ...): the order pip reads them in.
  const reqFiles = [...requirementFiles, ...nested].sort((a, b) => Number(baseOf(b) === "requirements.txt") - Number(baseOf(a) === "requirements.txt") || a.localeCompare(b));
  const manifests = [
    ...(repo.exists(pyprojectPath) ? [pyprojectPath] : []),
    ...reqFiles,
    ...["setup.py", "setup.cfg"].map((f) => inDir(dir, f)).filter((f) => repo.exists(f)),
  ];
  if (manifests.length === 0) return;

  const id = ids.take(slugOf(dir, "python"));
  const poetry = /^\[tool\.poetry\]/m.test(pyproject) || repo.exists(inDir(dir, "poetry.lock"));
  const uv = repo.exists(inDir(dir, "uv.lock")) || /^\[tool\.uv\]/m.test(pyproject);
  const pipenv = repo.exists(inDir(dir, "Pipfile"));
  const runner = uv ? "uv run " : poetry ? "poetry run " : "";
  if (uv || poetry) out.tools.push(uv ? "uv" : "poetry");

  // Where the dependencies live: an existing virtual environment is used as it is; otherwise one is created.
  const venvs = repo.snap.paths.filter((p) => baseOf(p) === "pyvenv.cfg" && dirOf(dirOf(p)) === dir).map((p) => baseOf(dirOf(p)));
  const existingVenv = venvs.includes(".venv") ? ".venv" : venvs.includes("venv") ? "venv" : venvs[0];
  const venv = existingVenv ?? ".venv";
  const pathPrepend = runner ? undefined : [inDir(dir, `${venv}/bin`), inDir(dir, `${venv}/Scripts`)];

  const text = [pyproject, ...manifests.filter((m) => m !== pyprojectPath).map((m) => repo.read(m) ?? ""), repo.read(inDir(dir, "tox.ini")) ?? ""].join("\n");
  const found: string[] = [];
  const tools: Array<{ gate: string; label: string; stage: GateStage; cmd: string; evidence: string; timeout: number }> = [];

  const ruffConfigured = /^\[tool\.ruff/m.test(pyproject) || repo.exists(inDir(dir, "ruff.toml")) || repo.exists(inDir(dir, ".ruff.toml"));
  if (ruffConfigured || toolMentioned(text, "ruff")) {
    tools.push({
      gate: "ruff",
      label: "Lint (ruff)",
      stage: "static",
      cmd: `${runner}ruff check .`,
      evidence: ruffConfigured ? `ruff config in ${repo.exists(inDir(dir, "ruff.toml")) ? inDir(dir, "ruff.toml") : pyprojectPath}` : "ruff is a dependency",
      timeout: 300,
    });
  } else if (repo.exists(inDir(dir, ".flake8")) || /^\[flake8\]/m.test(repo.read(inDir(dir, "setup.cfg")) ?? "") || toolMentioned(text, "flake8")) {
    tools.push({ gate: "flake8", label: "Lint (flake8)", stage: "static", cmd: `${runner}flake8`, evidence: "flake8 config or dependency", timeout: 300 });
  }
  const mypyConfigured = /^\[tool\.mypy\]/m.test(pyproject) || repo.exists(inDir(dir, "mypy.ini")) || repo.exists(inDir(dir, ".mypy.ini")) || /^\[mypy/m.test(repo.read(inDir(dir, "setup.cfg")) ?? "");
  if (mypyConfigured || toolMentioned(text, "mypy")) {
    const names = /^\s*(files|packages|modules)\s*=/m.test(pyproject) || /^\s*(files|packages|modules)\s*=/m.test(repo.read(inDir(dir, "mypy.ini")) ?? "");
    tools.push({
      gate: "mypy",
      label: "Type check (mypy)",
      stage: "static",
      cmd: `${runner}mypy${names ? "" : " ."}`,
      evidence: mypyConfigured ? "mypy config found" : "mypy is a dependency",
      timeout: 600,
    });
  }
  const testDirs = repo.snap.paths.some((p) => (p.startsWith(inDir(dir, "tests/")) || p.startsWith(inDir(dir, "test/"))) && /(^|\/)test_[^/]+\.py$|_test\.py$/.test(p));
  const pytestConfigured = /^\[tool\.pytest/m.test(pyproject) || repo.exists(inDir(dir, "pytest.ini")) || /^\[(tool:)?pytest\]/m.test(repo.read(inDir(dir, "setup.cfg")) ?? "") || /^\[pytest\]/m.test(repo.read(inDir(dir, "tox.ini")) ?? "");
  if (pytestConfigured || toolMentioned(text, "pytest") || (testDirs && repo.exists(inDir(dir, "conftest.py")))) {
    tools.push({
      gate: "pytest",
      label: "Tests (pytest)",
      stage: "unit",
      cmd: `${runner}pytest -q`,
      evidence: pytestConfigured ? "pytest config found" : toolMentioned(text, "pytest") ? "pytest is a dependency" : "conftest.py and tests/",
      timeout: 900,
    });
  }

  for (const t of tools) {
    found.push(t.gate);
    out.gates.push({
      id: `${id}.${t.gate}`,
      label: `${t.label}${dir === "." ? "" : ` in ${dir}`}`,
      stage: t.stage,
      cwd: dir,
      cmd: t.cmd,
      required: true,
      timeoutSeconds: t.timeout,
      ...(pathPrepend ? { pathPrepend } : {}),
      component: id,
      evidence: t.evidence,
    });
  }

  if (pipenv && !poetry && !uv) {
    out.notCovered.push(`${inDir(dir, "Pipfile")}: Pipenv is not wired (no install step, gates run with the tools on PATH). Add gates by hand if you need them.`);
  }

  // How to install: the project's own recipe, never a guess about its layout.
  let setup: DetectedSetup | undefined;
  const extras = optionalExtras(pyproject);
  const extra = ["dev", "test", "tests"].find((e) => extras.includes(e));
  const hasBuildTarget = /^\[(project|build-system)\]/m.test(pyproject);
  // The install command runs inside `dir`, so requirement files are named relative to it.
  const fromDir = (file: string) => (dir === "." ? file : file.slice(dir.length + 1));
  const installArgs = extra
    ? `-e ".[${extra}]"`
    : reqFiles.length > 0
      ? reqFiles.map((f) => `-r ${fromDir(f)}`).join(" ")
      : hasBuildTarget && !poetry && !uv
        ? "-e ."
        : "";
  if (uv || poetry) {
    setup = {
      id: `${id}.install`,
      label: `Install ${dir === "." ? "" : `${dir} `}dependencies (${uv ? "uv" : "poetry"})`.replace("  ", " "),
      component: id,
      cwd: dir,
      cmd: uv ? "uv sync" : "poetry install",
      toolchain: "python",
      manifests,
      marker: uv ? inDir(dir, ".venv") : "",
      tools: [uv ? "uv" : "poetry"],
      trustExisting: true,
    };
  } else if (installArgs && !pipenv) {
    const create = existingVenv === undefined;
    const requires = pyproject.match(/requires-python\s*=\s*["']\s*>=\s*(\d+\.\d+)/)?.[1];
    setup = {
      id: `${id}.install`,
      label: `Install ${dir === "." ? "" : `${dir} `}dependencies (pip${create ? `, new ${venv}` : `, existing ${venv}`})`.replace("  ", " "),
      component: id,
      cwd: dir,
      cmd: `${create ? `{python} -m venv ${venv} && ` : ""}{venv_python} -m pip install --quiet ${installArgs}`,
      toolchain: "python",
      manifests,
      marker: inDir(dir, venv),
      tools: [],
      venv,
      ...(create ? { minPython: requires ?? "3.9" } : {}),
      trustExisting: true,
    };
  } else if (found.length > 0 && !pipenv) {
    out.notCovered.push(`${dir === "." ? "The repository root" : dir}: Python gates were found but no install recipe (no requirements file, no [project] table), so nothing installs their dependencies. Install them yourself, or add a setup step.`);
  }
  if (setup) out.setup.push(setup);

  if (found.length === 0 && !setup) return;
  out.components.push({
    id,
    dir,
    kind: "python",
    summary: `${uv ? "uv" : poetry ? "poetry" : "pip"}${existingVenv ? ` (existing ${existingVenv})` : ""}: ${found.length > 0 ? found.join(", ") : "no lint/type/test tool configured"}`,
  });
  if (found.length === 0) {
    out.notCovered.push(`${dir === "." ? "The Python project at the root" : `The Python project in ${dir}`} configures no ruff, flake8, mypy or pytest, so it contributes no gate.`);
  }
  for (const file of here) {
    if (PYTHON_CONFIG.test(baseOf(file)) && baseOf(file) !== "conftest.py") out.guardedPaths.push(file);
  }
  if (repo.exists(pyprojectPath)) out.guardedPaths.push(pyprojectPath);
}

// --------------------------------------------------------------------------- Make

function detectMake(repo: Repo, out: Detection, ids: Ids): void {
  const makefile = ["Makefile", "makefile", "GNUmakefile"].find((f) => repo.exists(f));
  if (!makefile) return;
  const targets = new Set([...(repo.read(makefile) ?? "").matchAll(/^([A-Za-z0-9_.-]+)\s*:(?!=)/gm)].map((m) => m[1]!));
  const wanted: Array<[string, GateStage, string, number]> = [
    ["lint", "static", "Lint", 300],
    ["typecheck", "static", "Type check", 300],
    ["test", "unit", "Tests", 900],
    ["build", "build", "Build", 900],
  ];
  const id = ids.take("make");
  const found: string[] = [];
  for (const [target, stage, label, timeout] of wanted) {
    if (!targets.has(target)) continue;
    found.push(target);
    out.gates.push({
      id: `${id}.${target}`,
      label: `${label} (make ${target})`,
      stage,
      cwd: ".",
      cmd: `make ${target}`,
      required: true,
      timeoutSeconds: timeout,
      component: id,
      evidence: `${makefile} target ${target}`,
    });
  }
  if (found.length > 0) {
    out.tools.push("make");
    out.components.push({ id, dir: ".", kind: "make", summary: `make: ${found.join(", ")}` });
  }
}

// --------------------------------------------------------------------------- the repository around the code

const AGENT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONVENTIONS.md", ".cursorrules", ".windsurfrules", ".github/copilot-instructions.md"];

/** Manifests of ecosystems this version has no detector for. */
const OTHER_ECOSYSTEMS: Array<[RegExp, string]> = [
  [/(^|\/)go\.mod$/, "Go"],
  [/(^|\/)Cargo\.toml$/, "Rust"],
  [/(^|\/)pom\.xml$/, "Maven (Java)"],
  [/(^|\/)build\.gradle(\.kts)?$/, "Gradle (Java/Kotlin)"],
  [/(^|\/)Gemfile$/, "Ruby"],
  [/(^|\/)composer\.json$/, "PHP"],
  [/\.(sln|csproj)$/, ".NET"],
  [/(^|\/)mix\.exs$/, "Elixir"],
  [/(^|\/)pubspec\.yaml$/, "Dart/Flutter"],
];

function packageNameGuess(repo: Repo, snap: RepoSnapshot): string {
  const fromPackage = parseJson(repo.read("package.json"))?.name;
  if (typeof fromPackage === "string" && fromPackage.trim()) return fromPackage.replace(/^@[^/]+\//, "");
  const fromPyproject = repo.read("pyproject.toml")?.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
  return fromPyproject ?? snap.name;
}

export function detectProject(snap: RepoSnapshot): Detection {
  const repo = new Repo(snap);
  const out: Detection = {
    name: packageNameGuess(repo, snap),
    components: [],
    gates: [],
    setup: [],
    guardedPaths: [],
    tools: [],
    existing: { agentFiles: [], aiFiles: [], ci: [], compose: [], openapi: [] },
    notCovered: [],
    suggestions: [],
  };
  const ids = new Ids();

  // Node: a workspace is driven from its root scripts; otherwise every package.json is its own component.
  const rootPackage = parseJson(repo.read("package.json"));
  const workspaceRoot =
    rootPackage !== undefined &&
    (rootPackage.workspaces !== undefined || repo.exists("pnpm-workspace.yaml") || repo.exists("lerna.json") || repo.exists("nx.json") || repo.exists("turbo.json"));
  const nodeDirs = [...new Set(repo.dirsWith("package.json"))].filter((d) => depthOf(d) <= MAX_DEPTH && !skipped(d)).sort();
  const wantedNode = workspaceRoot ? ["."] : nodeDirs;
  if (workspaceRoot && nodeDirs.length > 1) {
    out.notCovered.push(
      `This is a workspace (${nodeDirs.length - 1} packages under the root): only the root package.json scripts were wired. Packages are covered when the root scripts run them (turbo, nx, pnpm -r ...).`,
    );
  }
  for (const dir of wantedNode.slice(0, MAX_COMPONENTS)) detectNode(repo, dir, ids, out, { workspaceRoot: workspaceRoot && dir === "." });

  // Python: any folder with a pyproject.toml, setup.py or requirements file.
  const pythonDirs = [
    ...new Set(
      repo.snap.paths
        .filter((p) => ["pyproject.toml", "setup.py"].includes(baseOf(p)) || REQUIREMENT_FILES.test(baseOf(p)))
        .map((p) => (dirOf(p).endsWith("/requirements") || dirOf(p) === "requirements" ? dirOf(dirOf(p)) : dirOf(p))),
    ),
  ]
    .filter((d) => depthOf(d) <= MAX_DEPTH && !skipped(d))
    .sort();
  for (const dir of pythonDirs.slice(0, Math.max(0, MAX_COMPONENTS - out.components.length))) detectPython(repo, dir, ids, out);

  if (out.components.length === 0) detectMake(repo, out, ids);

  // What is already here around the code.
  out.existing.agentFiles = [
    ...AGENT_FILES.filter((f) => repo.exists(f)),
    ...snap.paths.filter((p) => p.startsWith(".cursor/rules/")),
    ...snap.paths.filter((p) => p.startsWith(".claude/") && /\.(md|json)$/.test(p) && !p.includes("/skills/")).slice(0, 5),
  ];
  out.existing.aiFiles = snap.paths.filter((p) => p.startsWith(".ai/") && !p.startsWith(".ai/evidence/"));
  out.existing.ci = [
    ...snap.paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)),
    ...[".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml", ".circleci/config.yml", "bitbucket-pipelines.yml"].filter((f) => repo.exists(f)),
  ];
  out.existing.compose = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].filter((f) => repo.exists(f));
  out.existing.openapi = snap.paths.filter((p) => /(^|\/)(openapi|swagger)\.(json|ya?ml)$/.test(p) && !p.startsWith(".ai/") && !skipped(dirOf(p)));

  if (out.existing.compose.length > 0) {
    out.notCovered.push(
      `${out.existing.compose[0]} exists, but the app is not started for facts by default (runtime "none"): facts are \`cmd\`/\`file\` checks until you declare how to run it (adopt config: runtime).`,
    );
  }
  if (out.existing.openapi.length > 0) {
    out.notCovered.push(`${out.existing.openapi[0]} looks like an API contract; contract drift is not checked in this version.`);
  }
  if (out.existing.ci.length > 0) {
    out.notCovered.push(`Existing CI (${out.existing.ci[0]}${out.existing.ci.length > 1 ? ` and ${out.existing.ci.length - 1} more` : ""}) is left alone. It does not run the baseline-aware \`verify\`; add a job that does (see .ai/README.md).`);
  }
  const seenEcosystems = new Set<string>();
  for (const path of snap.paths) {
    if (skipped(dirOf(path))) continue;
    const hit = OTHER_ECOSYSTEMS.find(([re]) => re.test(path));
    if (hit && !seenEcosystems.has(hit[1])) {
      seenEcosystems.add(hit[1]);
      out.notCovered.push(`${hit[1]} project found (${path}) but this version has no detector for it. Add its commands as gates in the adopt config (gates.add).`);
    }
  }
  if (out.gates.length === 0) {
    out.notCovered.push("No lint, type-check, test or build command was found, so the project starts with no gates. Add them in the adopt config (gates.add), or add the scripts and re-run adopt.");
  }

  out.guardedPaths = [...new Set(out.guardedPaths)].sort();
  out.tools = [...new Set(out.tools)];
  return out;
}
