import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS_BEGIN, AGENTS_END, adoptProject, mergeAgentsBlock } from "../adopt/generate";
import { snapshotFromFiles } from "../adopt/detect";
import { generateProject } from "../generate";

const pkg = (o: Record<string, unknown>) => JSON.stringify(o);

/** Repositories that must all adopt coherently. */
const REPOS: Record<string, Record<string, string>> = {
  "node app": {
    "package.json": pkg({ name: "shop", scripts: { lint: "eslint .", test: "vitest run", build: "tsc" }, devDependencies: { vitest: "1" } }),
    "package-lock.json": "{}",
    "tsconfig.json": "{}",
  },
  "python service with an existing venv": {
    "pyproject.toml": '[project]\nname="api"\n[project.optional-dependencies]\ndev=["pytest"]\n[tool.pytest.ini_options]\n',
    ".venv/pyvenv.cfg": "home = /usr/bin",
  },
  "polyglot with agent files, CI and compose": {
    "web/package.json": pkg({ name: "web", scripts: { lint: "eslint ." }, dependencies: { next: "1" } }),
    "api/requirements.txt": "pytest\n",
    "api/pytest.ini": "[pytest]\n",
    "AGENTS.md": "# Existing\nKeep tabs.\n",
    "CLAUDE.md": "# claude",
    ".cursor/rules/a.mdc": "x",
    ".github/workflows/ci.yml": "name: ci",
    "docker-compose.yml": "services: {}",
  },
  "makefile only": { Makefile: "test:\n\techo ok\n" },
  "nothing recognisable": { "README.md": "# hi" },
};

function sdlcJson(result: ReturnType<typeof adoptProject>) {
  return JSON.parse(result.files.find((f) => f.path === ".ai/sdlc.json")!.content) as Record<string, any>;
}

describe.each(Object.entries(REPOS))("adopting: %s", (_name, files) => {
  const result = adoptProject(snapshotFromFiles(files, "some-repo"));

  it("writes only inside .ai/ (the root AGENTS.md is a managed block, not a file)", () => {
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(result.files.length).toBeGreaterThan(20);
    for (const f of result.files) expect(f.path.startsWith(".ai/"), f.path).toBe(true);
    expect(result.agentsBlock).toContain("<!-- scaffolder:begin -->");
  });

  it("generates nothing a greenfield project owns: no CI, compose, Dockerfiles, worked example, scripts/ or stack rules", () => {
    const paths = result.files.map((f) => f.path);
    expect(paths.filter((p) => /workflows|docker|compose|FEAT-000|^scripts\/|backend-python|web-nextjs|contract/i.test(p))).toEqual([]);
    expect(paths).toEqual(expect.arrayContaining([".ai/sdlc", ".ai/sdlc.cmd", ".ai/sdlc.py", ".ai/sdlc.json", ".ai/specs/_template/prd.md", ".ai/context/commands.md"]));
  });

  it("leaves no template tag, undefined value or greenfield launcher path in any file", () => {
    for (const f of result.files) {
      expect(f.content, f.path).not.toMatch(/<%|%>/);
      expect(f.content, f.path).not.toContain("undefined");
      expect(f.content, f.path).not.toMatch(/scripts[\\/]sdlc/);
      // the runner still knows the greenfield worked example by name; nothing else may mention it
      if (f.path !== ".ai/sdlc.py") expect(f.content, f.path).not.toContain("FEAT-000");
    }
    expect(result.agentsBlock).not.toMatch(/<%|%>|undefined/);
  });

  it("the launcher is where the files say it is: .ai/sdlc, and the runner finds the repository root from there", () => {
    const launcher = result.files.find((f) => f.path === ".ai/sdlc")!;
    expect(launcher.executable).toBe(true);
    expect(launcher.content).toContain("$DIR/sdlc.py");
    const cmd = result.files.find((f) => f.path === ".ai/sdlc.cmd")!;
    expect(cmd.content).toContain("\r\n");
    expect(cmd.content).not.toMatch(/[^\r]\n/);
    const runner = result.files.find((f) => f.path === ".ai/sdlc.py")!;
    expect(runner.executable).toBe(true);
    expect(runner.content).toContain("ROOT = Path(__file__).resolve().parent.parent");
    expect(runner.content).toContain("./.ai/sdlc baseline");
  });

  it("the runner is valid Python", () => {
    const dir = mkdtempSync(join(tmpdir(), "adopt-py-"));
    try {
      const file = join(dir, "sdlc.py");
      writeFileSync(file, result.files.find((f) => f.path === ".ai/sdlc.py")!.content);
      const r = spawnSync("python3", ["-I", "-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", file], { encoding: "utf-8" });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(".ai/sdlc.json: a ratchet, protected machinery, frozen specs, and every gate from the repository", () => {
    const cfg = sdlcJson(result);
    expect(cfg.ratchet).toEqual({ enabled: true, baseline: ".ai/baseline.json" });
    expect(cfg.secrets).toEqual({ baseline: ".ai/secrets.baseline.json" });
    expect(cfg.facts).toMatchObject({ specsDir: ".ai/specs", requireSpec: false });
    expect(cfg.integrity.protected).toEqual(
      expect.arrayContaining([".ai/sdlc.json", ".ai/sdlc", ".ai/sdlc.cmd", ".ai/sdlc.py", ".ai/baseline.json", ".ai/secrets.baseline.json", ".github/workflows/"]),
    );
    expect(cfg.integrity.protectedWhileHealing).toEqual([".ai/specs/"]);
    expect(cfg.runtime.mode).toBe("none");
    expect(cfg.agent.prompts.implement).toBe(".ai/prompts/implement.md");
    const secrets = cfg.gates.find((g: any) => g.id === "repo.secrets");
    expect(secrets).toMatchObject({ stage: "security", required: true, cmd: "python3 .ai/sdlc.py secrets" });
    // stage order is the loop's order
    const order = cfg.stages as string[];
    const idx = cfg.gates.map((g: any) => order.indexOf(g.stage));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    for (const step of cfg.setup) expect(step.trustExisting).toBe(true);
    for (const step of cfg.setup) expect(step.cmd).not.toContain("--clear");
  });

  it("every file is valid and every JSON file parses", () => {
    for (const f of result.files.filter((x) => x.path.endsWith(".json"))) expect(() => JSON.parse(f.content), f.path).not.toThrow();
  });
});

describe("adopting: what depends on the repository", () => {
  it("lists the gates, their evidence and what was not covered in commands.md", () => {
    const r = adoptProject(snapshotFromFiles(REPOS["polyglot with agent files, CI and compose"]!, "r"));
    const doc = r.files.find((f) => f.path === ".ai/context/commands.md")!.content;
    expect(doc).toContain("`web.lint`");
    expect(doc).toContain("`api.pytest`");
    expect(doc).toContain("Existing CI");
    expect(doc).toContain("docker-compose.yml exists");
  });

  it("points agents at guidance that was already in the repository, except the AGENTS.md it edits", () => {
    const r = adoptProject(snapshotFromFiles(REPOS["polyglot with agent files, CI and compose"]!, "r"));
    expect(r.agentsBlock).toContain("`CLAUDE.md`");
    expect(r.agentsBlock).toContain("`.cursor/rules/a.mdc`");
    expect(r.agentsBlock).not.toMatch(/- `AGENTS\.md`/);
    expect(r.hints.join(" ")).toContain("@AGENTS.md");
    const plain = adoptProject(snapshotFromFiles(REPOS["node app"]!, "r"));
    expect(plain.agentsBlock).not.toContain("already in this repository");
    expect(plain.hints).toEqual([]);
  });

  it("guards the repository's own configuration", () => {
    const cfg = sdlcJson(adoptProject(snapshotFromFiles(REPOS["node app"]!, "r")));
    expect(cfg.integrity.guarded).toEqual(["tsconfig.json"]);
  });

  it("a folder with a one-letter name is still adoptable", () => {
    const r = adoptProject(snapshotFromFiles({ "Makefile": "test:\n\techo\n" }, "x"));
    expect(r.config.project.name).toBe("x-app");
    expect(r.files.length).toBeGreaterThan(0);
  });

  it("rootFile none writes nothing outside .ai/", () => {
    const r = adoptProject(snapshotFromFiles(REPOS["node app"]!, "r"), { rootFile: "none" });
    expect(r.agentsBlock).toBeNull();
    expect(r.hints).toEqual([]);
  });
});

describe("adopt settings", () => {
  const snap = () => snapshotFromFiles(REPOS["node app"]!, "r");

  it("can drop a detected gate and add one for a stack that cannot be detected", () => {
    const r = adoptProject(snap(), {
      gates: {
        exclude: ["node.build"],
        add: [{ id: "go.test", label: "Go tests", stage: "unit", cmd: "go test ./...", timeoutSeconds: 300 }],
      },
    });
    const ids = sdlcJson(r).gates.map((g: any) => g.id);
    expect(ids).not.toContain("node.build");
    expect(ids).toContain("go.test");
    expect(sdlcJson(r).gates.find((g: any) => g.id === "go.test")).toMatchObject({ cwd: ".", required: true, timeoutSeconds: 300, component: "custom" });
  });

  it("rejects settings that would produce a broken project", () => {
    const bad = (input: unknown) => adoptProject(snap(), input).issues.filter((i) => i.level === "error").map((i) => i.path);
    expect(bad({ gates: { add: [{ id: "node.lint", label: "x", stage: "unit", cmd: "x" }] } })).toContain("gates.add[0].id");
    expect(bad({ gates: { add: [{ id: "a.b", label: "x", stage: "facts", cmd: "x" }] } })).toContain("gates.add[0].stage");
    expect(bad({ gates: { add: [{ id: "a.b", label: "x", stage: "unit", cmd: " " }] } })).toContain("gates.add[0].cmd");
    expect(bad({ gates: { add: [{ id: "a.b", label: "x", stage: "unit", cmd: "x", cwd: "../out" }] } })).toContain("gates.add[0].cwd");
    expect(bad({ runtime: { mode: "local" } })).toContain("runtime.local.services");
    expect(bad({ runtime: { mode: "docker", docker: { provides: ["web"] } } })).toContain("runtime.docker.composeFile");
    expect(bad({ sdlc: { maxIterations: 0 } })).toContain("sdlc.maxIterations");
    expect(bad({ sdlc: { protectedPaths: ["../etc"] } })).toContain("sdlc.protectedPaths[0]");
    expect(bad({ sdlc: { agent: { preset: "custom" } } })).toContain("sdlc.agent.command");
    expect(bad({ rootFile: "everywhere" })).toContain("rootFile");
    expect(adoptProject(snap(), { gates: { add: [{ id: "a.b", label: "x", stage: "unit", cmd: "x" }] } }).files).not.toEqual([]);
    expect(adoptProject(snap(), { runtime: { mode: "local" } }).files).toEqual([]);
  });

  it("warns, rather than fails, when a project starts with no gates", () => {
    const r = adoptProject(snapshotFromFiles({ "README.md": "x" }, "r"));
    expect(r.issues.some((i) => i.level === "warning" && i.path === "gates")).toBe(true);
    expect(r.files.length).toBeGreaterThan(0);
  });

  it("a declared local runtime reaches sdlc.json, and a docker one gets a project name of its own", () => {
    const local = sdlcJson(
      adoptProject(snap(), {
        runtime: {
          mode: "local",
          targets: { web: "http://127.0.0.1:3000" },
          local: { services: [{ name: "web", cwd: ".", cmd: "npm start", env: {}, pathPrepend: [], healthUrl: "http://127.0.0.1:3000/", startTimeoutSeconds: 60 }] },
        },
      }),
    );
    expect(local.runtime).toMatchObject({ mode: "local", targets: { web: "http://127.0.0.1:3000" }, local: { provides: ["web"] } });
    const docker = sdlcJson(
      adoptProject(snapshotFromFiles({ ...REPOS["node app"]!, "docker-compose.yml": "services: {}" }, "my-shop"), {
        runtime: { mode: "docker", docker: { provides: ["web"] } },
      }),
    );
    // never the developer's own compose project: `down --volumes` on it would delete their data
    expect(docker.runtime.docker.up).toBe("docker compose -p shop-sdlc -f docker-compose.yml up -d --build --wait");
    expect(docker.runtime.docker.down).toContain("-p shop-sdlc");
  });
});

describe("the managed block in AGENTS.md", () => {
  const block = `${AGENTS_BEGIN}\nnew text\n${AGENTS_END}`;

  it("creates the file when there is none", () => {
    expect(mergeAgentsBlock(undefined, block).content).toBe(`# AGENTS.md\n\n${block}\n`);
    expect(mergeAgentsBlock("  \n", block).content).toBe(`# AGENTS.md\n\n${block}\n`);
  });

  it("appends to a file that exists without touching a character of it", () => {
    const mine = "# My rules\n\nUse tabs.\n";
    const merged = mergeAgentsBlock(mine, block).content;
    expect(merged.startsWith(mine.trimEnd())).toBe(true);
    expect(merged.endsWith(`${block}\n`)).toBe(true);
  });

  it("replaces only what is between the markers, and is idempotent", () => {
    const old = `before\n\n${AGENTS_BEGIN}\nold text\n${AGENTS_END}\n\nafter\n`;
    const once = mergeAgentsBlock(old, block).content;
    expect(once).toBe(`before\n\n${block}\n\nafter\n`);
    expect(mergeAgentsBlock(once, block).content).toBe(once);
  });

  it("refuses a half-edited block instead of guessing", () => {
    const broken = `x\n${AGENTS_BEGIN}\nno end marker\n`;
    const r = mergeAgentsBlock(broken, block);
    expect(r.problem).toContain("without its pair");
    expect(r.content).toBe(broken);
  });
});

describe("generated (greenfield) projects are not affected", () => {
  it("still use scripts/ for the runner and have no baseline machinery in their config", () => {
    const { files } = generateProject({});
    const paths = files.map((f) => f.path);
    expect(paths).toContain("scripts/sdlc.py");
    expect(paths).not.toContain(".ai/sdlc.py");
    const cfg = JSON.parse(files.find((f) => f.path === ".ai/sdlc.json")!.content);
    expect(cfg.ratchet).toBeUndefined();
    expect(cfg.facts.requireSpec).toBeUndefined();
    expect(files.find((f) => f.path === "AGENTS.md")!.content).toContain("./scripts/sdlc verify");
  });
});
