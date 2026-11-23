import { describe, expect, it } from "vitest";
import { detectProject, snapshotFromFiles } from "../adopt/detect";

const pkg = (o: Record<string, unknown>) => JSON.stringify(o);
const detect = (files: Record<string, string>, name = "repo") => detectProject(snapshotFromFiles(files, name));
const gateIds = (d: ReturnType<typeof detect>) => d.gates.map((g) => g.id);

describe("detection: Node", () => {
  it("wires the scripts the repository defines, with evidence, and nothing else", () => {
    const d = detect({
      "package.json": pkg({ name: "shop", scripts: { lint: "eslint .", "type-check": "tsc --noEmit", test: "vitest run", build: "tsc", dev: "vite" }, devDependencies: { vitest: "1" } }),
      "package-lock.json": "{}",
    });
    expect(d.name).toBe("shop");
    expect(d.gates.map((g) => [g.id, g.stage, g.cmd, g.cwd])).toEqual([
      ["node.lint", "static", "npm run lint", "."],
      ["node.types", "static", "npm run type-check", "."],
      ["node.test", "unit", "npm run test", "."],
      ["node.build", "build", "npm run build", "."],
    ]);
    expect(d.gates.every((g) => g.evidence.startsWith("package.json scripts."))).toBe(true);
    expect(d.gates.find((g) => g.id === "node.test")?.env).toEqual({ CI: "true" });
    expect(d.tools).toEqual(["node", "npm"]);
    // dev is not a gate: a server never ends. It is only offered as a way to run the app for facts.
    expect(gateIds(d)).not.toContain("node.dev");
    expect(d.suggestions.join(" ")).toContain("scripts.dev");
  });

  it("uses the package manager the lockfile names", () => {
    const base = { name: "x", scripts: { test: "jest" }, devDependencies: { jest: "1" } };
    const pnpm = detect({ "package.json": pkg(base), "pnpm-lock.yaml": "" });
    expect(pnpm.gates[0]?.cmd).toBe("pnpm run test");
    expect(pnpm.setup[0]).toMatchObject({ cmd: "pnpm install --frozen-lockfile", fallbackCmd: "pnpm install", lockfile: "pnpm-lock.yaml", tools: ["node", "pnpm"] });
    const yarn = detect({ "package.json": pkg(base), "yarn.lock": "" });
    expect(yarn.setup[0]?.cmd).toBe("yarn install --frozen-lockfile");
    const berry = detect({ "package.json": pkg(base), "yarn.lock": "", ".yarnrc.yml": "" });
    expect(berry.setup[0]?.cmd).toBe("yarn install --immutable");
    const declared = detect({ "package.json": pkg({ ...base, packageManager: "pnpm@9.1.0" }) });
    expect(declared.gates[0]?.cmd).toBe("pnpm run test");
    const bun = detect({ "package.json": pkg(base), "bun.lockb": "" });
    expect(bun.setup[0]?.cmd).toBe("bun install --frozen-lockfile");
  });

  it("does not turn placeholders or watch-mode scripts into gates, and says so", () => {
    const d = detect({
      "package.json": pkg({ name: "x", scripts: { test: 'echo "Error: no test specified" && exit 1', lint: "eslint .", build: "jest --watch" } }),
    });
    expect(gateIds(d)).toEqual(["node.lint"]);
    expect(d.notCovered.join("\n")).toContain("no test specified");
    expect(d.notCovered.join("\n")).toContain("watch mode");
  });

  it("only lists an install step when there are dependencies, and trusts an environment that exists", () => {
    const none = detect({ "package.json": pkg({ name: "x", scripts: { lint: "eslint ." } }) });
    expect(none.setup).toEqual([]);
    const some = detect({ "package.json": pkg({ name: "x", scripts: { lint: "eslint ." }, dependencies: { a: "1" } }) });
    expect(some.setup[0]).toMatchObject({ id: "node.install", marker: "node_modules", trustExisting: true });
  });

  it("drives a workspace from its root scripts", () => {
    const d = detect({
      "package.json": pkg({ name: "mono", workspaces: ["packages/*"], scripts: { test: "turbo run test", build: "turbo run build" } }),
      "packages/a/package.json": pkg({ name: "a", scripts: { test: "jest" } }),
      "packages/b/package.json": pkg({ name: "b", scripts: { test: "jest" } }),
    });
    expect(d.components.map((c) => c.dir)).toEqual(["."]);
    expect(gateIds(d)).toEqual(["node.test", "node.build"]);
    expect(d.notCovered.join("\n")).toContain("workspace");
  });

  it("treats independent package.json files as separate components with their own gates", () => {
    const d = detect({
      "web/package.json": pkg({ name: "web", scripts: { lint: "eslint ." } }),
      "tools/cli/package.json": pkg({ name: "cli", scripts: { test: "node --test" } }),
    });
    expect(gateIds(d)).toEqual(["tools-cli.test", "web.lint"]);
    expect(d.gates.map((g) => g.cwd)).toEqual(["tools/cli", "web"]);
  });

  it("ignores copies of the project (node_modules, examples, fixtures, templates)", () => {
    const d = detect({
      "package.json": pkg({ name: "x", scripts: { lint: "eslint ." } }),
      "node_modules/dep/package.json": pkg({ name: "dep", scripts: { test: "x" } }),
      "examples/demo/package.json": pkg({ name: "demo", scripts: { test: "x" } }),
      "templates/app/package.json": pkg({ name: "tpl", scripts: { test: "x" } }),
      "test/fixtures/p/package.json": pkg({ name: "f", scripts: { test: "x" } }),
    });
    expect(gateIds(d)).toEqual(["node.lint"]);
  });

  it("reports an unreadable package.json instead of guessing", () => {
    const d = detect({ "package.json": "{ not json" });
    expect(d.gates).toEqual([]);
    expect(d.notCovered.join("\n")).toContain("could not be read");
  });

  it("marks the repository's lint, type and test configuration as guarded", () => {
    const d = detect({
      "package.json": pkg({ name: "x", scripts: { lint: "eslint ." } }),
      "eslint.config.mjs": "",
      "tsconfig.json": "{}",
      "vitest.config.ts": "",
      "README.md": "",
    });
    expect(d.guardedPaths).toEqual(["eslint.config.mjs", "tsconfig.json", "vitest.config.ts"]);
  });
});

describe("detection: Python", () => {
  const modern = [
    "[project]",
    'name = "api"',
    'requires-python = ">=3.11"',
    "[project.optional-dependencies]",
    'dev = ["pytest", "ruff", "mypy"]',
    "[tool.ruff]",
    "line-length = 100",
    "[tool.mypy]",
    "strict = true",
    "[tool.pytest.ini_options]",
    'addopts = "-q"',
  ].join("\n");

  it("wires ruff, mypy and pytest that the project configures, creating a venv only when none exists", () => {
    const d = detect({ "pyproject.toml": modern });
    expect(d.gates.map((g) => [g.id, g.stage, g.cmd])).toEqual([
      ["python.ruff", "static", "ruff check ."],
      ["python.mypy", "static", "mypy ."],
      ["python.pytest", "unit", "pytest -q"],
    ]);
    expect(d.gates[0]?.pathPrepend).toEqual([".venv/bin", ".venv/Scripts"]);
    expect(d.setup[0]).toMatchObject({
      cmd: '{python} -m venv .venv && {venv_python} -m pip install --quiet -e ".[dev]"',
      minPython: "3.11",
      venv: ".venv",
      marker: ".venv",
      trustExisting: true,
    });
    // creating a venv must never use --clear: it would wipe one that is already there
    expect(d.setup[0]?.cmd).not.toContain("--clear");
  });

  it("uses an existing virtual environment as it is: no venv command, no minimum Python", () => {
    const d = detect({ "pyproject.toml": modern, "venv/pyvenv.cfg": "home = /usr/bin" });
    expect(d.setup[0]?.cmd).toBe('{venv_python} -m pip install --quiet -e ".[dev]"');
    expect(d.setup[0]).toMatchObject({ venv: "venv", marker: "venv" });
    expect(d.setup[0]?.minPython).toBeUndefined();
    expect(d.gates[0]?.pathPrepend).toEqual(["venv/bin", "venv/Scripts"]);
  });

  it("prefers requirements files when there is no dev extra", () => {
    const d = detect({
      "requirements.txt": "flask\n",
      "requirements-dev.txt": "pytest\nruff\n",
      "pytest.ini": "[pytest]\n",
    });
    expect(d.setup[0]?.cmd).toBe("{python} -m venv .venv && {venv_python} -m pip install --quiet -r requirements.txt -r requirements-dev.txt");
    expect(gateIds(d)).toEqual(["python.ruff", "python.pytest"]);
    expect(d.gates[0]?.evidence).toBe("ruff is a dependency");
  });

  it("names requirement files relative to the folder the command runs in", () => {
    const d = detect({ "services/api/requirements.txt": "pytest\n", "services/api/pytest.ini": "[pytest]\n" });
    expect(d.setup[0]).toMatchObject({ cwd: "services/api", id: "services-api.install" });
    expect(d.setup[0]?.cmd).toContain("-r requirements.txt");
    expect(d.setup[0]?.cmd).not.toContain("services/api/requirements.txt");
    expect(d.gates[0]?.pathPrepend).toEqual(["services/api/.venv/bin", "services/api/.venv/Scripts"]);
  });

  it("runs poetry and uv projects through their own runner and installer", () => {
    const poetry = detect({ "pyproject.toml": '[tool.poetry]\nname = "x"\n[tool.pytest.ini_options]\n', "poetry.lock": "" });
    expect(poetry.gates[0]?.cmd).toBe("poetry run pytest -q");
    expect(poetry.gates[0]?.pathPrepend).toBeUndefined();
    expect(poetry.setup[0]).toMatchObject({ cmd: "poetry install", tools: ["poetry"], marker: "" });
    expect(poetry.tools).toContain("poetry");
    const uv = detect({ "pyproject.toml": "[project]\nname='x'\n[tool.pytest.ini_options]\n", "uv.lock": "" });
    expect(uv.gates[0]?.cmd).toBe("uv run pytest -q");
    expect(uv.setup[0]).toMatchObject({ cmd: "uv sync", marker: ".venv" });
  });

  it("does not guess for Pipenv or for a project with no way to install it", () => {
    const pipenv = detect({ Pipfile: "", "pytest.ini": "[pytest]\n", "requirements.txt": "x\n" });
    expect(pipenv.setup).toEqual([]);
    expect(pipenv.notCovered.join("\n")).toContain("Pipenv");
    const bare = detect({ "pyproject.toml": "[tool.pytest.ini_options]\n" });
    expect(bare.setup).toEqual([]);
    expect(bare.notCovered.join("\n")).toContain("no install recipe");
  });

  it("adds a mypy gate only for a project that configures or depends on it", () => {
    expect(gateIds(detect({ "pyproject.toml": "[tool.pytest.ini_options]\n" }))).toEqual(["python.pytest"]);
    expect(detect({ "pyproject.toml": "[tool.mypy]\nfiles = ['src']\n" }).gates[0]?.cmd).toBe("mypy");
  });
});

describe("detection: everything else", () => {
  it("falls back to Makefile targets only when there is no Node or Python component", () => {
    const makeOnly = detect({ Makefile: "lint:\n\techo\ntest:\n\techo\nrelease:\n\techo\n" });
    expect(makeOnly.gates.map((g) => [g.id, g.cmd])).toEqual([
      ["make.lint", "make lint"],
      ["make.test", "make test"],
    ]);
    expect(makeOnly.tools).toEqual(["make"]);
    const both = detect({ Makefile: "test:\n\techo\n", "package.json": pkg({ name: "x", scripts: { test: "jest" } }) });
    expect(gateIds(both)).toEqual(["node.test"]);
  });

  it("an empty or unrecognised repository gets no gates and says what it did not find", () => {
    const d = detect({ "README.md": "# hi", "main.go": "package main", "go.mod": "module x" });
    expect(d.gates).toEqual([]);
    expect(d.components).toEqual([]);
    expect(d.notCovered.join("\n")).toContain("Go project found");
    expect(d.notCovered.join("\n")).toContain("No lint, type-check, test or build command was found");
  });

  it("recognises what is already there: agent files, CI, compose, OpenAPI, an existing .ai", () => {
    const d = detect({
      "package.json": pkg({ name: "x", scripts: { lint: "eslint ." } }),
      "AGENTS.md": "# a",
      "CLAUDE.md": "# c",
      ".cursor/rules/style.mdc": "x",
      ".github/copilot-instructions.md": "x",
      ".github/workflows/ci.yml": "name: ci",
      "docker-compose.yml": "services: {}",
      "docs/openapi.json": "{}",
      "api/openapi.yaml": "x",
      ".ai/old.md": "x",
    });
    expect(d.existing.agentFiles).toEqual(["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md", ".cursor/rules/style.mdc"]);
    expect(d.existing.ci).toEqual([".github/workflows/ci.yml"]);
    expect(d.existing.compose).toEqual(["docker-compose.yml"]);
    expect(d.existing.openapi).toEqual(["api/openapi.yaml"]); // docs/ is skipped: it holds examples
    expect(d.existing.aiFiles).toEqual([".ai/old.md"]);
    const notes = d.notCovered.join("\n");
    expect(notes).toContain("Existing CI");
    expect(notes).toContain("docker-compose.yml exists");
    expect(notes).toContain("API contract");
  });

  it("names the project after package.json, then pyproject.toml, then the folder", () => {
    expect(detect({ "package.json": pkg({ name: "@acme/shop" }) }, "dir").name).toBe("shop");
    expect(detect({ "pyproject.toml": '[project]\nname = "api-svc"\n' }, "dir").name).toBe("api-svc");
    expect(detect({}, "my-folder").name).toBe("my-folder");
  });
});
