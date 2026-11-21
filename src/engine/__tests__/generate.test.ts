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
  "web only (Next.js, no API)": { backend: { enabled: false }, database: { type: "none" } },
  "web only, no docker, no cd, local runtime": {
    backend: { enabled: false },
    database: { type: "none" },
    docker: { enabled: false },
    cd: { enabled: false },
    sdlc: { runtime: "local" },
  },
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

describe("generated project: web only (Next.js, no API)", () => {
  const WEB_ONLY = { backend: { enabled: false }, database: { type: "none" } };
  const { files } = generate(WEB_ONLY);
  const index = byPath(files);
  const text = (path: string) => index.get(path)!.content;
  const sdlc = () => JSON.parse(text(".ai/sdlc.json")) as Json;

  it("has the web app and nothing of the backend, the contract or an API client", () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain("web/package.json");
    expect(paths.filter((p) => p.startsWith("backend/"))).toEqual([]);
    expect(paths.filter((p) => p.includes("contract") || p.includes("openapi"))).toEqual([]);
    expect(paths).not.toContain("web/src/lib/api.ts");
    expect(paths).not.toContain("web/src/__tests__/api.test.ts");
    expect(paths).toContain("web/src/lib/greeting.ts");
    expect(paths).toContain("web/src/__tests__/greeting.test.ts");
  });

  it("the page needs no API: it renders its own greeting", () => {
    const page = text("web/src/app/page.tsx");
    expect(page).toContain("greeting(");
    expect(page).not.toMatch(/fetchHello|API_URL|@\/lib\/api/);
    expect(text("web/Dockerfile")).not.toContain("API_URL");
  });

  it("runs one web service in compose, with no API_URL and nothing to wait for", () => {
    const compose = parse(text("docker-compose.yml")) as Json;
    expect(Object.keys(compose.services)).toEqual(["web"]);
    expect(compose.services.web.depends_on).toBeUndefined();
    expect(compose.services.web.environment).toBeUndefined();
    expect(text(".env.example")).not.toMatch(/API_URL|BACKEND|CORS|POSTGRES/);
  });

  it("the loop runs the web app alone: one target, one service, no contract to guard", () => {
    const cfg = sdlc();
    expect(Object.keys(cfg.runtime.targets)).toEqual(["web"]);
    expect(cfg.runtime.docker.provides).toEqual(["web"]);
    expect(cfg.runtime.local.provides).toEqual(["web"]);
    expect(cfg.runtime.local.services.map((s: Json) => s.name)).toEqual(["web"]);
    expect(cfg.runtime.local.services[0].env.API_URL).toBeUndefined();
    expect(cfg.integrity.guarded).toEqual([]);
    expect((cfg.gates as Json[]).map((g) => g.id).filter((id) => id.startsWith("backend."))).toEqual([]);
    expect((cfg.setup as Json[]).map((s) => s.id)).toEqual(["web.install"]);
  });

  it("the sample spec is about the page, and every check hits the web target", () => {
    const acceptance = JSON.parse(text(".ai/specs/FEAT-000-hello-world/acceptance.json")) as Json;
    expect((acceptance.checks as Json[]).map((c) => [c.type, c.target])).toEqual([["http", "web"], ["http", "web"], ["http", "web"]]);
    expect(text(".ai/specs/FEAT-000-hello-world/prd.md")).not.toMatch(/backend|\/health|openapi/i);
    const blank = JSON.parse(text(".ai/specs/_template/acceptance.json")) as Json;
    expect(blank.checks[0].target).toBe("web");
  });

  it("the agent's rules and prompts never send it to a backend that does not exist", () => {
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain(".ai/rules/contract.md");
    expect(paths).not.toContain(".ai/skills/define-contract/SKILL.md");
    for (const path of paths.filter((p) => /^(\.ai\/(rules|skills|prompts)\/|\.ai\/README\.md|AGENTS\.md|README\.md|\.github\/pull_request)/.test(p))) {
      expect(text(path), path).not.toMatch(/backend\.contract|openapi|app\.export_openapi|\.ai\/contract|rules\/contract\.md|define-contract/);
    }
    expect(text(".ai/prompts/spec.md")).toContain('"target": "web"');
    expect(text(".ai/prompts/spec.md")).not.toContain('"target": "backend"');
    expect(text(".ai/rules/web-nextjs.md")).not.toContain("API_URL");
  });

  it("CI has a web job and no backend job", () => {
    const ci = parse(text(".github/workflows/ci.yml")) as Json;
    expect(Object.keys(ci.jobs)).toEqual(["web", "repo", "facts"]);
  });

  it("a project with a backend is unchanged: API client, contract and the wiring to the API", () => {
    const full = byPath(generate({}).files);
    expect(full.has("web/src/lib/api.ts")).toBe(true);
    expect(full.has("web/src/lib/greeting.ts")).toBe(false);
    expect(full.has(".ai/rules/contract.md")).toBe(true);
    const compose = parse(full.get("docker-compose.yml")!.content) as Json;
    expect(compose.services.web.depends_on).toEqual({ backend: { condition: "service_healthy" } });
    expect(compose.services.web.environment.API_URL).toBeDefined();
    const loop = JSON.parse(full.get(".ai/sdlc.json")!.content) as Json;
    expect(loop.runtime.local.provides).toEqual(["backend", "web"]);
    expect(loop.integrity.guarded).toEqual([".ai/contract/"]);
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

  it("makes local setup Python-version aware while CI keeps plain python3", () => {
    const { files } = generate({ backend: { version: "3.13" } });
    const sdlc = JSON.parse(files.find((f) => f.path === ".ai/sdlc.json")!.content) as Json;
    const step = (sdlc.setup as Json[]).find((s) => s.id === "backend.install")!;
    expect(step.minPython).toBe("3.13");
    expect(step.cmd).toMatch(/^\{python\} -m venv --clear \.venv/);

    const ci = parse(files.find((f) => f.path === ".github/workflows/ci.yml")!.content) as Json;
    const ciCommands = (ci.jobs.backend.steps as Json[]).map((s) => s.run as string | undefined);
    expect(ciCommands.some((c) => c?.startsWith("python3 -m venv --clear .venv"))).toBe(true);
    expect(JSON.stringify(ci)).not.toContain("{python}");
    // the node step has no Python requirement
    expect((sdlc.setup as Json[]).find((s) => s.id === "web.install")!.minPython).toBeUndefined();
  });

  it("never pins the database to a fixed host port (it would clash with a local Postgres)", () => {
    const { files } = generate({});
    const compose = parse(files.find((f) => f.path === "docker-compose.yml")!.content) as Json;
    expect(compose.services.postgres.ports).toEqual(["127.0.0.1:${POSTGRES_PORT:-}:5432"]);
    expect(files.find((f) => f.path === ".env.example")!.content).toMatch(/^# POSTGRES_PORT=5432$/m);
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

describe("agent and `implement`", () => {
  const sdlcOf = (patch: Json) => {
    const { files } = generate(patch);
    return {
      sdlc: JSON.parse(files.find((f) => f.path === ".ai/sdlc.json")!.content) as Json,
      agents: files.find((f) => f.path === "AGENTS.md")!.content,
      files,
    };
  };

  it("defaults to the claude preset and writes the resolved command into sdlc.json", () => {
    const { sdlc, agents } = sdlcOf({});
    expect(sdlc.agent.preset).toBe("claude");
    expect(sdlc.agent.command).toMatch(/^claude -p /);
    expect(agents).toContain("preset `claude`");
  });

  it("supports the codex preset, a custom command, and an explicit override of a preset", () => {
    expect(sdlcOf({ sdlc: { agent: { preset: "codex" } } }).sdlc.agent.command).toMatch(/^codex exec /);
    expect(sdlcOf({ sdlc: { agent: { preset: "custom", command: "my-agent --stdin" } } }).sdlc.agent.command).toBe("my-agent --stdin");
    expect(sdlcOf({ sdlc: { agent: { preset: "claude", command: "other-agent" } } }).sdlc.agent.command).toBe("other-agent");
  });

  it("with no agent the docs say a human is in the loop", () => {
    const { sdlc, agents } = sdlcOf({ sdlc: { agent: { preset: "none" } } });
    expect(sdlc.agent.command).toBe("");
    expect(agents).toContain("currently empty");
  });

  it("rejects an unknown preset and a custom preset without a command", () => {
    const errors = (patch: Json) => validateConfig(resolveConfig(patch)).filter((i) => i.level === "error").map((i) => i.path);
    expect(errors({ sdlc: { agent: { preset: "skynet" } } })).toContain("sdlc.agent.preset");
    expect(errors({ sdlc: { agent: { preset: "custom" } } })).toContain("sdlc.agent.command");
  });

  it("setup steps say what to install when (manifests) and how to tell it never ran (marker)", () => {
    const { sdlc } = sdlcOf({ layout: { backendDir: "services/api", webDir: "apps/web" } });
    const steps = sdlc.setup as Json[];
    expect(steps.find((s) => s.id === "backend.install")).toMatchObject({
      manifests: ["services/api/pyproject.toml"],
      marker: "services/api/.venv",
    });
    expect(steps.find((s) => s.id === "web.install")).toMatchObject({
      manifests: ["apps/web/package.json"],
      marker: "apps/web/node_modules",
    });
  });

  it("documents implement and sync where people look (AGENTS.md, README, Makefile, skills)", () => {
    const { files } = sdlcOf({});
    const text = (path: string) => files.find((f) => f.path === path)!.content;
    for (const path of ["AGENTS.md", "README.md"]) expect(text(path), path).toContain("./scripts/sdlc implement");
    expect(text("AGENTS.md")).toContain("./scripts/sdlc sync");
    expect(text("Makefile")).toMatch(/^implement:/m);
    expect(text(".ai/skills/write-prd/SKILL.md")).toContain("./scripts/sdlc implement");
  });

  it("the implement prompt only uses placeholders the tool fills in, and embeds the spec", () => {
    const { files } = sdlcOf({});
    const prompt = files.find((f) => f.path === ".ai/prompts/implement.md")!.content;
    const used = [...new Set([...prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))].sort();
    const tool = files.find((f) => f.path === "scripts/sdlc.py")!.content;
    const block = tool.slice(tool.indexOf('render_prompt(cfg["agent"]["prompts"]["implement"]'));
    for (const key of used) expect(block, `sdlc.py does not fill {{${key}}}`).toContain(`"${key}":`);
    expect(used).toEqual(expect.arrayContaining(["prd", "acceptance", "questionsFile", "specDir", "feature"]));
    // the agent is told to ask instead of guessing, to sync dependencies, and not to commit
    expect(prompt).toContain("./scripts/sdlc sync");
    expect(prompt).toContain("do not guess");
    expect(prompt).toMatch(/Do \*\*not\*\* run `git commit`/);
  });
});

describe("`spec`: a requirements document to a draft spec", () => {
  const { files } = generate({});
  const text = (path: string) => files.find((f) => f.path === path)!.content;
  const placeholders = (s: string) => [...new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))].sort();

  it("registers the spec prompts in sdlc.json", () => {
    const sdlc = JSON.parse(text(".ai/sdlc.json")) as Json;
    expect(sdlc.agent.prompts).toMatchObject({ spec: ".ai/prompts/spec.md", specFix: ".ai/prompts/spec-fix.md" });
    expect(files.some((f) => f.path === ".ai/prompts/spec.md")).toBe(true);
    expect(files.some((f) => f.path === ".ai/prompts/spec-fix.md")).toBe(true);
  });

  it("the spec prompts only use placeholders the tool fills in", () => {
    const tool = text("scripts/sdlc.py");
    const specValues = tool.slice(tool.indexOf("values = {"), tool.indexOf('prompt = render_prompt(cfg["agent"]["prompts"]["spec"]'));
    for (const key of placeholders(text(".ai/prompts/spec.md"))) {
      expect(specValues, `{{${key}}} in spec.md is never filled`).toContain(`"${key}":`);
    }
    const fixValues = tool.slice(tool.indexOf('cfg["agent"]["prompts"]["specFix"]'), tool.indexOf('cfg["agent"]["prompts"]["specFix"]') + 400);
    for (const key of placeholders(text(".ai/prompts/spec-fix.md"))) {
      expect(fixValues, `{{${key}}} in spec-fix.md is never filled`).toContain(`"${key}":`);
    }
  });

  it("tells the agent to cite sources, never invent requirements, and write only the two spec files", () => {
    const prompt = text(".ai/prompts/spec.md");
    expect(prompt).toContain("(Source:");
    expect(prompt).toContain("Never invent requirements");
    expect(prompt).toContain("ASSUMPTION:");
    expect(prompt).toContain("exactly two files");
    expect(prompt).toContain("{{questionsFile}}");
  });

  it("documents spec and the review step where people look", () => {
    for (const path of ["AGENTS.md", "README.md"]) expect(text(path), path).toContain("./scripts/sdlc spec");
    expect(text("Makefile")).toMatch(/^spec:/m);
    expect(text(".ai/skills/review-spec/SKILL.md")).toContain("Nothing invented");
    expect(text(".ai/skills/write-prd/SKILL.md")).toContain("./scripts/sdlc spec");
  });

  it("validates that http checks point at targets that exist (a typo used to be skipped silently)", () => {
    expect(text("scripts/sdlc.py")).toContain("which does not exist (available:");
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

  it("accepts a web app on its own, but not with a database, which needs a backend", () => {
    expect(hasErrors(check({ backend: { enabled: false }, database: { type: "none" } }))).toBe(false);
    expect(errorPaths({ backend: { enabled: false } })).toEqual(["database.type"]);
  });

  it("rejects incoherent combinations", () => {
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
