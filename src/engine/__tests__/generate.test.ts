import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { generateProject, type GeneratedFile } from "../generate";
import { toZip, renderTree } from "../zip";
import { defaultConfig, deepMerge, hasErrors, resolveConfig, validateConfig } from "../config";
import { renderTemplate, findMissingVariables } from "../render";
import { unzipSync } from "fflate";

type Json = Record<string, any>;

/** Configurations that must all generate a coherent project. */
const MATRIX: Record<string, Json> = {
  default: {},
  "backend only": { web: { enabled: false } },
  "no database": { database: { type: "none" } },
  "backend only, no database": { web: { enabled: false }, database: { type: "none" } },
  "custom directories": { layout: { backendDir: "services/api", webDir: "apps/web" } },
  "python 3.11, node 24, custom ports": {
    backend: { version: "3.11", port: 9100 },
    web: { nodeVersion: "24", port: 9200 },
  },
  "local runtime, no docker, no cd": {
    docker: { enabled: false },
    cd: { enabled: false },
    sdlc: { runtime: "local" },
  },
  "no runtime facts": { sdlc: { runtime: "none" } },
  "no ci": { ci: { provider: "none" }, cd: { enabled: false } },
  "ssh-compose deploy, manual env": {
    cd: {
      target: "ssh-compose",
      environments: [
        { name: "qa", url: "https://qa.example.com", trigger: "manual" },
        { name: "prod", url: "https://example.com", trigger: "tag" },
      ],
    },
  },
  "all gates off": {
    sdlc: {
      gates: { lint: false, types: false, unit: false, build: false, contract: false, facts: false, security: false },
    },
  },
  "proprietary license, agent configured": {
    project: { license: "UNLICENSED" },
    sdlc: { agent: { command: "my-agent --stdin" }, maxIterations: 9 },
  },
};

function generate(patch: Json) {
  const result = generateProject(deepMerge(defaultConfig(), patch));
  expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
  return result;
}

const byPath = (files: GeneratedFile[]) => new Map(files.map((f) => [f.path, f]));

describe.each(Object.entries(MATRIX))("generated project: %s", (_name, patch) => {
  const { config, files } = generate(patch);
  const index = byPath(files);

  it("has no unresolved template tags and no duplicate paths", () => {
    expect(index.size).toBe(files.length);
    for (const f of files) {
      expect(f.content, f.path).not.toMatch(/<%|%>/);
    }
  });

  it("emits parseable JSON and YAML", () => {
    for (const f of files) {
      if (f.path.endsWith(".json") && !f.path.endsWith("tsconfig.json")) JSON.parse(f.content);
      if (/\.ya?ml$/.test(f.path)) expect(() => parse(f.content), f.path).not.toThrow();
    }
  });

  it("marks scripts executable and only scripts", () => {
    expect(index.get("scripts/sdlc")?.executable).toBe(true);
    expect(index.get("scripts/sdlc.py")?.executable).toBe(true);
    for (const f of files) {
      if (f.path.endsWith(".sh")) expect(f.executable, f.path).toBe(true);
      if (f.path.endsWith(".md")) expect(f.executable, f.path).toBe(false);
    }
  });

  it("only gates whose working directory exists in the project", () => {
    const sdlc = JSON.parse(index.get(".ai/sdlc.json")!.content) as Json;
    for (const gate of sdlc.gates as Json[]) {
      if (gate.cwd === ".") continue;
      expect(files.some((f) => f.path.startsWith(`${gate.cwd}/`)), `${gate.id} -> ${gate.cwd}`).toBe(true);
    }
    for (const step of sdlc.setup as Json[]) {
      expect(files.some((f) => f.path.startsWith(`${step.cwd}/`)), step.id).toBe(true);
    }
  });

  it("only checks targets and needs that the runtime can provide", () => {
    const sdlc = JSON.parse(index.get(".ai/sdlc.json")!.content) as Json;
    const targets = Object.keys(sdlc.runtime.targets);
    const acceptance = JSON.parse(index.get(".ai/specs/FEAT-000-hello-world/acceptance.json")!.content) as Json;
    const prd = index.get(".ai/specs/FEAT-000-hello-world/prd.md")!.content;
    const acIds = new Set([...prd.matchAll(/^\s*[-*]\s+\*\*(AC-\d+)\*\*/gm)].map((m) => m[1]));
    const covered = new Set<string>();
    for (const check of acceptance.checks as Json[]) {
      if (check.type === "http") expect(targets, check.id).toContain(check.target);
      for (const ac of check.covers as string[]) {
        expect(acIds.has(ac), `${check.id} covers unknown ${ac}`).toBe(true);
        covered.add(ac);
      }
    }
    // Traceability: no acceptance criterion without a check.
    expect([...acIds].filter((id) => !covered.has(id))).toEqual([]);
  });

  it("gives CI exactly the commands the local loop runs", () => {
    const ci = index.get(".github/workflows/ci.yml");
    if (config.ci.provider !== "github-actions") {
      expect(ci).toBeUndefined();
      return;
    }
    const sdlc = JSON.parse(index.get(".ai/sdlc.json")!.content) as Json;
    const workflow = parse(ci!.content) as Json;
    const stepCommands = Object.values(workflow.jobs as Json).flatMap((job: Json) =>
      (job.steps as Json[]).map((s) => s.run as string | undefined),
    );
    for (const gate of sdlc.gates as Json[]) {
      expect(stepCommands, gate.id).toContain(gate.cmd);
    }
  });

  it("keeps compose, CD and deploy files consistent with the config", () => {
    expect(index.has("docker-compose.yml")).toBe(config.docker.enabled);
    expect(index.has(".github/workflows/cd.yml")).toBe(config.cd.enabled && config.ci.provider === "github-actions");
    expect(index.has("scripts/deploy.sh")).toBe(config.cd.enabled);
    if (config.cd.enabled) {
      expect(index.has(`deploy/targets/${config.cd.target}.sh`)).toBe(true);
      const cd = parse(index.get(".github/workflows/cd.yml")!.content) as Json;
      for (const env of config.cd.environments) expect(cd.jobs[`deploy-${env.name}`], env.name).toBeDefined();
      // CD must be gated by CI, and deploys by the image build.
      expect(cd.jobs.images.needs).toBe("ci");
    }
    if (config.docker.enabled) {
      const compose = parse(index.get("docker-compose.yml")!.content) as Json;
      expect(Object.keys(compose.services).sort()).toEqual(
        [config.backend.enabled && "backend", config.web.enabled && "web", config.database.type !== "none" && "postgres"]
          .filter(Boolean)
          .sort(),
      );
    }
  });
});

describe("generated project: specifics", () => {
  it("has no web files for a backend-only project and no db code without a database", () => {
    const { files } = generate({ web: { enabled: false }, database: { type: "none" } });
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.startsWith("web/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("backend/app/db/"))).toBe(false);
    expect(paths).not.toContain("backend/tests/test_db.py");
    expect(files.find((f) => f.path === "backend/pyproject.toml")!.content).not.toContain("asyncpg");
  });

  it("honours custom directories everywhere (gates, compose, CI, contract path)", () => {
    const { files } = generate({ layout: { backendDir: "services/api", webDir: "apps/web" } });
    const index = byPath(files);
    expect(index.has("services/api/pyproject.toml")).toBe(true);
    expect(index.has("apps/web/package.json")).toBe(true);
    const sdlc = JSON.parse(index.get(".ai/sdlc.json")!.content) as Json;
    const contract = (sdlc.gates as Json[]).find((g) => g.id === "backend.contract")!;
    expect(contract.cmd).toContain("../../.ai/contract/openapi.json");
    const compose = parse(index.get("docker-compose.yml")!.content) as Json;
    expect(compose.services.backend.build.context).toBe("./services/api");
  });

  it("bakes configuration into the loop: iterations, agent, coverage floors", () => {
    const { files } = generate({
      sdlc: { maxIterations: 9, noProgressLimit: 4, agent: { command: "my-agent" }, coverage: { backend: 91, web: 66 } },
    });
    const index = byPath(files);
    const sdlc = JSON.parse(index.get(".ai/sdlc.json")!.content) as Json;
    expect(sdlc.loop).toMatchObject({ maxIterations: 9, noProgressLimit: 4 });
    expect(sdlc.agent.command).toBe("my-agent");
    expect((sdlc.gates as Json[]).find((g) => g.id === "backend.unit")!.cmd).toContain("--cov-fail-under=91");
    expect(index.get("web/vitest.config.mts")!.content).toContain("lines: 66");
  });

  it("protects the verification machinery from the agent", () => {
    const sdlc = JSON.parse(generate({}).files.find((f) => f.path === ".ai/sdlc.json")!.content) as Json;
    expect(sdlc.integrity.protected).toEqual(expect.arrayContaining([".ai/sdlc.json", "scripts/sdlc.py", ".github/workflows/"]));
    expect(sdlc.integrity.protectedWhileHealing).toContain(".ai/specs/");
  });

  it("lets GitHub Actions expressions and runtime placeholders through untouched", () => {
    const { files } = generate({});
    const cd = files.find((f) => f.path === ".github/workflows/cd.yml")!.content;
    expect(cd).toContain("${{ secrets.GITHUB_TOKEN }}");
    const heal = files.find((f) => f.path === ".ai/prompts/heal.md")!.content;
    expect(heal).toContain("{{failures}}");
  });

  it("is deterministic apart from the copyright year", () => {
    const a = generate({}).files.map((f) => [f.path, f.content]);
    const b = generate({}).files.map((f) => [f.path, f.content]);
    expect(a).toEqual(b);
  });

  it("generated scripts are syntactically valid (bash -n, python ast)", () => {
    const { files } = generate({ cd: { target: "ssh-compose" } });
    const dir = mkdtempSync(join(tmpdir(), "scaffolder-syntax-"));
    try {
      for (const f of files) {
        const isSh = f.path.endsWith(".sh") || f.path === "scripts/sdlc";
        const isPy = f.path.endsWith(".py");
        if (!isSh && !isPy) continue;
        const file = join(dir, f.path.replace(/\//g, "__"));
        writeFileSync(file, f.content);
        const probe = isSh
          ? spawnSync("bash", ["-n", file], { encoding: "utf8" })
          : spawnSync("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", file], { encoding: "utf8" });
        if (probe.error) continue; // tool not installed: skip rather than fail
        expect(probe.status, `${f.path}\n${probe.stderr}`).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("validation", () => {
  const check = (patch: Json) => validateConfig(resolveConfig(patch));
  const errorPaths = (patch: Json) => check(patch).filter((i) => i.level === "error").map((i) => i.path);

  it("accepts the default configuration", () => {
    expect(hasErrors(check({}))).toBe(false);
  });

  it("rejects stacks that have no pack yet instead of generating stubs", () => {
    expect(errorPaths({ backend: { language: "java", framework: "spring-boot", version: "21" } })).toContain("backend.language");
    expect(errorPaths({ web: { framework: "vue" } })).toContain("web.framework");
    expect(errorPaths({ mobile: { enabled: true } })).toContain("mobile.enabled");
    expect(errorPaths({ database: { type: "mysql" } })).toContain("database.type");
    expect(errorPaths({ auth: { type: "jwt" } })).toContain("auth.type");
    expect(errorPaths({ cache: { type: "redis" } })).toContain("cache.type");
  });

  it("rejects incoherent combinations", () => {
    expect(errorPaths({ backend: { enabled: false } })).toContain("web.enabled");
    expect(errorPaths({ web: { enabled: false }, backend: { enabled: false } })).toContain("backend.enabled");
    expect(errorPaths({ web: { port: 8000 } })).toContain("web.port");
    expect(errorPaths({ docker: { enabled: false } })).toContain("sdlc.runtime");
    expect(errorPaths({ ci: { provider: "none" } })).toContain("cd.enabled");
    expect(errorPaths({ layout: { webDir: "backend" } })).toContain("layout.webDir");
    expect(errorPaths({ layout: { backendDir: "../escape" } })).toContain("layout.backendDir");
  });

  it("bounds the loop settings", () => {
    expect(errorPaths({ sdlc: { maxIterations: 0 } })).toContain("sdlc.maxIterations");
    expect(errorPaths({ sdlc: { maxIterations: 99 } })).toContain("sdlc.maxIterations");
    expect(errorPaths({ sdlc: { coverage: { backend: 101 } } })).toContain("sdlc.coverage.backend");
    expect(errorPaths({ sdlc: { agent: { command: "a\nb" } } })).toContain("sdlc.agent.command");
  });

  it("validates environments", () => {
    const envs = [
      { name: "staging", url: "https://s.example.com", trigger: "manual" },
      { name: "staging", url: "not a url", trigger: "sometimes" },
    ];
    const paths = errorPaths({ cd: { environments: envs } });
    expect(paths).toEqual(expect.arrayContaining(["cd.environments[1].name", "cd.environments[1].url", "cd.environments[1].trigger"]));
  });

  it("normalises the project name and returns no files when invalid", () => {
    expect(resolveConfig({ project: { name: "  My Cool_App!! " } }).project.name).toBe("my-cool-app");
    const bad = generateProject({ web: { port: 8000 } });
    expect(bad.files).toEqual([]);
    expect(hasErrors(bad.issues)).toBe(true);
  });
});

describe("renderer", () => {
  it("fails loudly on a variable the view does not define", () => {
    expect(() => renderTemplate("hello <%nope%>", {}, "x.tmpl")).toThrow(/x\.tmpl.*nope/);
  });

  it("checks variables inside list sections and treats false as defined", () => {
    expect(findMissingVariables("<%#items%><%a%><%/items%><%flag%>", { items: [{ a: 1 }], flag: false })).toEqual([]);
    expect(findMissingVariables("<%#items%><%b%><%/items%>", { items: [{ a: 1 }] })).toEqual(["b"]);
  });

  it("never HTML-escapes and leaves {{ }} and ${{ }} alone", () => {
    expect(renderTemplate("<%v%> {{keep}} ${{ x }} [[ -f a ]]", { v: "a&b<c>" })).toBe("a&b<c> {{keep}} ${{ x }} [[ -f a ]]");
  });
});

describe("zip and tree", () => {
  it("round-trips files under a root folder and keeps the executable bit", () => {
    const { files } = generate({});
    const zip = toZip(files, "hello-scaffold");
    const entries = unzipSync(zip);
    expect(Object.keys(entries)).toHaveLength(files.length);
    expect(Object.keys(entries)).toContain("hello-scaffold/scripts/sdlc.py");
    expect(new TextDecoder().decode(entries["hello-scaffold/README.md"])).toBe(files.find((f) => f.path === "README.md")!.content);
    expect(toZip(files, "hello-scaffold")).toEqual(zip); // reproducible
  });

  it("renders a tree with directories first", () => {
    const tree = renderTree(["b.txt", "a/x.txt", "a/y/z.txt"], "root");
    expect(tree.split("\n")).toEqual(["root/", "├── a/", "│   ├── y/", "│   │   └── z.txt", "│   └── x.txt", "└── b.txt"]);
  });
});
