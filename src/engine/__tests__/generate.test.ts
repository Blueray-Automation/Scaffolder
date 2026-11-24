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
  "full stack with Nuxt": { web: { framework: "nuxt" } },
  "web only (Nuxt, no API)": { web: { framework: "nuxt" }, backend: { enabled: false }, database: { type: "none" } },
  "Nuxt, node 24, custom directories and ports, no docker": {
    web: { framework: "nuxt", nodeVersion: "24", port: 9300 },
    layout: { backendDir: "services/api", webDir: "apps/web" },
    docker: { enabled: false },
    cd: { enabled: false },
    sdlc: { runtime: "local" },
  },
  "full stack with Flutter": { mobile: { enabled: true } },
  "Flutter with the backend, no web": { web: { enabled: false }, mobile: { enabled: true } },
  "Flutter app on its own": {
    backend: { enabled: false },
    web: { enabled: false },
    database: { type: "none" },
    mobile: { enabled: true },
  },
  "Flutter beside a web app, no backend": { backend: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } },
  "Flutter, custom directory, local runtime, no ci": {
    mobile: { enabled: true },
    layout: { mobileDir: "apps/mobile" },
    ci: { provider: "none" },
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
    expect(cfg.integrity.guarded).toEqual([".ai/design/"]);
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
    expect(loop.integrity.guarded).toEqual([".ai/contract/", ".ai/design/"]);
  });
});

describe("generated project: Nuxt", () => {
  const full = generate({ web: { framework: "nuxt" } });
  const only = generate({ web: { framework: "nuxt" }, backend: { enabled: false }, database: { type: "none" } });
  const textOf = (files: GeneratedFile[]) => (path: string) => byPath(files).get(path)!.content;
  const fullText = textOf(full.files);
  const onlyText = textOf(only.files);
  const sdlcOf = (files: GeneratedFile[]) => JSON.parse(textOf(files)(".ai/sdlc.json")) as Json;

  it("generates the Nuxt app, and nothing of Next.js", () => {
    const paths = full.files.map((f) => f.path);
    for (const path of ["web/nuxt.config.ts", "web/app/app.vue", "web/app/pages/index.vue", "web/app/components/HelloCard.vue", "web/vitest.config.ts", "web/Dockerfile"]) {
      expect(paths, path).toContain(path);
    }
    expect(paths.filter((p) => p.startsWith("web/src/") || p === "web/next.config.mjs" || p === "web/vitest.config.mts")).toEqual([]);
    expect(paths).toContain(".ai/rules/web-nuxt.md");
    expect(paths).not.toContain(".ai/rules/web-nextjs.md");
    expect(fullText("web/package.json")).not.toMatch(/"next"|eslint-config-next|"react"/);
  });

  it("nothing outside the Next.js pack talks about Next.js", () => {
    for (const f of [...full.files, ...only.files]) {
      expect(f.content, f.path).not.toMatch(/Next\.js|next build|NEXT_TELEMETRY|web-nextjs/);
    }
  });

  it("with an API the page asks its own route, which calls the backend through the typed client", () => {
    const paths = full.files.map((f) => f.path);
    for (const path of ["web/server/utils/api.ts", "web/server/api/hello.get.ts", "web/server/__tests__/api.test.ts", "web/server/__tests__/hello.get.test.ts"]) {
      expect(paths, path).toContain(path);
    }
    expect(paths).not.toContain("web/app/utils/greeting.ts");
    expect(fullText("web/app/pages/index.vue")).toContain('useFetch("/api/hello"');
    expect(fullText("web/app/pages/index.vue")).not.toMatch(/API_URL|fetchHello/);
    expect(fullText("web/server/api/hello.get.ts")).toContain("fetchHello()");
    expect(fullText("web/server/utils/api.ts")).toContain("process.env.API_URL");
    expect(fullText("web/server/utils/api.ts")).toContain("http://localhost:8000");
  });

  it("the backend address is a runtime variable: never in the build configuration or the image's build stage", () => {
    expect(fullText("web/nuxt.config.ts")).not.toMatch(/API_URL|runtimeConfig/);
    const dockerfile = fullText("web/Dockerfile");
    expect(dockerfile).not.toMatch(/ENV[^\n]*API_URL|ARG[^\n]*API_URL/);
    expect(dockerfile).toContain("API_URL is read at request time");
  });

  it("on its own the page renders its own greeting, with no API client or route", () => {
    const paths = only.files.map((f) => f.path);
    expect(paths.filter((p) => p.startsWith("backend/") || p.startsWith("web/server/"))).toEqual([]);
    expect(paths).toContain("web/app/utils/greeting.ts");
    expect(paths).toContain("web/app/__tests__/greeting.test.ts");
    expect(onlyText("web/app/pages/index.vue")).toContain("greeting(");
    expect(onlyText("web/app/pages/index.vue")).not.toMatch(/useFetch|API_URL/);
    expect(onlyText("web/Dockerfile")).not.toContain("API_URL");
    expect(onlyText(".ai/rules/web-nuxt.md")).not.toContain("API_URL");
    expect(onlyText(".ai/prompts/spec.md")).toContain("`.ai/rules/web-nuxt.md`");
    expect(onlyText(".ai/skills/implement-feature/SKILL.md")).toContain("`.ai/rules/web-nuxt.md`");
    expect(only.files.filter((f) => f.path.startsWith("web/")).map((f) => f.path).sort()).toEqual(
      [
        "web/.dockerignore", "web/Dockerfile", "web/app/__tests__/HelloCard.test.ts", "web/app/__tests__/greeting.test.ts", "web/app/__tests__/index.test.ts",
        "web/app/app.vue", "web/app/assets/css/main.css", "web/app/assets/css/tokens.css", "web/app/components/HelloCard.vue", "web/app/pages/index.vue", "web/app/utils/greeting.ts",
        "web/eslint.config.mjs", "web/nuxt.config.ts", "web/package.json", "web/public/robots.txt", "web/tsconfig.json", "web/vitest.config.ts",
      ].sort(),
    );
  });

  it("the gates say what they run, and the production build runs without telemetry", () => {
    const gates = sdlcOf(full.files).gates as Json[];
    const gate = (id: string) => gates.find((g) => g.id === id)!;
    expect(gate("web.types").label).toBe("Web type check (vue-tsc)");
    expect(gate("web.build").label).toBe("Web production build (nuxt build)");
    expect(gate("web.build").env).toEqual({ NUXT_TELEMETRY_DISABLED: "1" });
    for (const id of ["web.lint", "web.types", "web.unit", "web.build"]) expect(gate(id).cwd, id).toBe("web");
    const scripts = JSON.parse(fullText("web/package.json")).scripts as Record<string, string>;
    expect(gate("web.lint").cmd).toBe("npm run lint");
    expect(scripts.lint).toContain("eslint --max-warnings 0");
    expect(scripts["test:coverage"]).toContain("--coverage");
  });

  it("the loop starts the built server on the configured port, on loopback, with the backend's address", () => {
    const patched = generate({ web: { framework: "nuxt", port: 9300 } });
    const service = (sdlcOf(patched.files).runtime.local.services as Json[]).find((s) => s.name === "web")!;
    expect(service.cmd).toBe("npm run start");
    expect(service.env).toEqual({ API_URL: "http://127.0.0.1:8000", NUXT_TELEMETRY_DISABLED: "1", NITRO_PORT: "9300", NITRO_HOST: "127.0.0.1" });
    expect(service.healthUrl).toBe("http://127.0.0.1:9300/");
    expect(JSON.parse(textOf(patched.files)("web/package.json")).scripts.start).toBe("node .output/server/index.mjs");
    expect(textOf(patched.files)("web/package.json")).toContain('"dev": "nuxt dev --port 9300"');
  });

  it("the image serves the build output on port 3000 as a non-root user, whatever host port is configured", () => {
    const dockerfile = fullText("web/Dockerfile");
    expect(dockerfile).toContain("NITRO_PORT=3000");
    expect(dockerfile).toContain("NITRO_HOST=0.0.0.0");
    expect(dockerfile).toContain("USER app");
    expect(dockerfile).toContain('CMD ["node", "server/index.mjs"]');
    expect(dockerfile).toMatch(/FROM node:22-alpine AS runtime/);
    const compose = parse(fullText("docker-compose.yml")) as Json;
    expect(compose.services.web.ports).toEqual(["${WEB_PORT:-3000}:3000"]);
    expect(generate({ web: { framework: "nuxt", nodeVersion: "24" } }).files.find((f) => f.path === "web/Dockerfile")!.content).toContain("FROM node:24-alpine AS runtime");
  });

  it("the build folders are ignored by git and skipped by the secret scan", () => {
    expect(fullText(".gitignore")).toMatch(/^\.nuxt\/$/m);
    expect(fullText(".gitignore")).toMatch(/^\.output\/$/m);
    expect(fullText("scripts/sdlc.py")).toMatch(/SECRET_SKIP_DIRS = \{[^}]*"\.output"/);
    expect(fullText("web/.dockerignore")).toMatch(/^\.output$/m);
  });

  it("the documentation describes the app as Nuxt", () => {
    expect(fullText("README.md")).toContain("Nuxt 4 (Vue 3, TypeScript) page that renders the greeting fetched from the API at request time; Vitest + ESLint + `vue-tsc` preconfigured.");
    expect(onlyText("README.md")).toContain("Nuxt 4 (Vue 3, TypeScript) page that greets the visitor");
    expect(fullText("AGENTS.md")).toContain("Nuxt app (Node 22, TypeScript)");
    expect(onlyText(".ai/specs/FEAT-000-hello-world/prd.md")).toContain("the Nuxt app renders the page itself");
  });

  it("the Next.js project is unchanged by Nuxt being available", () => {
    const next = generate({});
    expect(next.config.web.framework).toBe("nextjs");
    const text = textOf(next.files);
    expect(text(".ai/rules/web-nextjs.md")).toContain("Next.js App Router");
    expect(text("README.md")).toContain("Next.js (App Router, TypeScript) page that renders the greeting");
    expect((sdlcOf(next.files).gates as Json[]).find((g) => g.id === "web.build")).toMatchObject({
      label: "Web production build (next build)",
      env: { NEXT_TELEMETRY_DISABLED: "1" },
    });
    const service = (sdlcOf(next.files).runtime.local.services as Json[]).find((s) => s.name === "web")!;
    expect(service.cmd).toBe("npm run start -- --port 3000 --hostname 127.0.0.1");
    expect(service.env).toEqual({ API_URL: "http://127.0.0.1:8000", NEXT_TELEMETRY_DISABLED: "1" });
  });
});

describe("generated project: Flutter", () => {
  const ONLY = { backend: { enabled: false }, web: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } };
  const WITH_API = { web: { enabled: false }, mobile: { enabled: true } };
  const BESIDE_WEB = { backend: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } };
  const FULL = { mobile: { enabled: true } };
  const only = generate(ONLY);
  const api = generate(WITH_API);
  const beside = generate(BESIDE_WEB);
  const full = generate(FULL);
  const textOf = (files: GeneratedFile[]) => (path: string) => {
    const file = byPath(files).get(path);
    if (!file) throw new Error(`no generated file ${path}`);
    return file.content;
  };
  const sdlcOf = (files: GeneratedFile[]) => JSON.parse(textOf(files)(".ai/sdlc.json")) as Json;
  const acceptanceOf = (files: GeneratedFile[]) => JSON.parse(textOf(files)(".ai/specs/FEAT-000-hello-world/acceptance.json")) as Json;
  const pathsUnder = (files: GeneratedFile[], prefix: string) => files.map((f) => f.path).filter((p) => p.startsWith(prefix)).sort();

  it("a Flutter app on its own is these files, with the rules for working in it", () => {
    expect(pathsUnder(only.files, "mobile/")).toEqual(
      [
        "analysis_options.yaml", "lib/app.dart", "lib/greeting.dart", "lib/main.dart", "lib/theme/app_theme.dart", "lib/theme/tokens.dart", "lib/ui/hello_card.dart", "lib/ui/hello_page.dart",
        "pubspec.yaml", "README.md", "test/greeting_test.dart", "test/tool/check_coverage_test.dart", "test/ui/hello_card_test.dart",
        "test/ui/hello_page_test.dart", "test/widget_test.dart", "tool/check_coverage.dart",
      ].map((p) => `mobile/${p}`).sort(),
    );
    expect(only.files.map((f) => f.path)).toContain(".ai/rules/mobile-flutter.md");
    expect(only.files.map((f) => f.path)).not.toContain(".ai/rules/web-nextjs.md");
  });

  it("next to a backend it has a typed API client and its tests instead of the greeting logic", () => {
    expect(pathsUnder(api.files, "mobile/")).toEqual(
      [
        "analysis_options.yaml", "lib/api/hello_client.dart", "lib/app.dart", "lib/main.dart", "lib/theme/app_theme.dart", "lib/theme/tokens.dart", "lib/ui/hello_card.dart", "lib/ui/hello_page.dart",
        "pubspec.yaml", "README.md", "test/api/hello_client_test.dart", "test/integration/backend_test.dart", "test/tool/check_coverage_test.dart",
        "test/ui/hello_card_test.dart", "test/ui/hello_page_test.dart", "test/widget_test.dart", "tool/check_coverage.dart",
      ].map((p) => `mobile/${p}`).sort(),
    );
    const text = textOf(api.files);
    expect(text("mobile/lib/main.dart")).toContain("HelloApp(client: HelloClient())");
    expect(text("mobile/lib/ui/hello_page.dart")).toContain("import '../api/hello_client.dart';");
    expect(text("mobile/lib/api/hello_client.dart")).toContain("String.fromEnvironment(");
    expect(text("mobile/lib/api/hello_client.dart")).toContain("'http://localhost:8000'");
    expect(text("mobile/pubspec.yaml")).toMatch(/^ {2}http: \^1\.\d+\.\d+$/m);
    const own = textOf(only.files);
    expect(own("mobile/pubspec.yaml")).not.toMatch(/\bhttp:/);
    expect(only.files.filter((f) => f.path.endsWith(".dart")).map((f) => f.content).join("\n")).not.toMatch(/package:http|API_URL|HelloClient/);
  });

  it("the backend's address in the client and in the spec follows the configured port", () => {
    const moved = generate({ ...WITH_API, backend: { port: 9100 } });
    expect(textOf(moved.files)("mobile/lib/api/hello_client.dart")).toContain("http://localhost:9100");
    expect(textOf(moved.files)("mobile/lib/api/hello_client.dart")).not.toContain("8000");
    const check = (acceptanceOf(moved.files).checks as Json[]).find((c) => c.covers.includes("AC-008"))!;
    expect(check.run).toContain("--dart-define=API_URL=http://127.0.0.1:9100");
  });

  it("generates no platform folders (flutter create writes the current ones) and never the deprecated Material import", () => {
    for (const result of [only, api, beside, full]) {
      expect(result.files.map((f) => f.path).filter((p) => /^mobile\/(android|ios|web|macos|linux|windows)\//.test(p))).toEqual([]);
      for (const f of result.files.filter((f) => f.path.endsWith(".dart"))) {
        expect(f.content, f.path).not.toContain("package:flutter/material.dart");
        expect(f.content, f.path).not.toMatch(/<%|%>/);
      }
      expect(textOf(result.files)("mobile/analysis_options.yaml")).toMatch(/- android\/\*\*\n\s+- ios\/\*\*/);
    }
    expect(textOf(only.files)("mobile/lib/ui/hello_page.dart")).toContain("package:material_ui/material_ui.dart");
  });

  it("the gates say what they run, run in the mobile folder, and need only the Flutter SDK", () => {
    const gates = sdlcOf(only.files).gates as Json[];
    expect(gates.filter((g) => g.component === "mobile").map((g) => [g.id, g.stage, g.cwd, g.required])).toEqual([
      ["mobile.analyze", "static", "mobile", true],
      ["mobile.unit", "unit", "mobile", true],
      ["mobile.build", "build", "mobile", true],
    ]);
    const gate = (id: string) => gates.find((g) => g.id === id)!;
    // analysis first: it installs the dependencies, which the formatter needs to read analysis_options.yaml without warnings
    expect(gate("mobile.analyze").cmd).toBe("flutter analyze --fatal-infos && dart format --output=none --set-exit-if-changed .");
    expect(gate("mobile.unit").cmd).toBe("flutter test --coverage && dart run tool/check_coverage.dart --min 70");
    expect(gate("mobile.build").cmd).toBe("flutter build bundle");
    expect(gate("mobile.unit").label).toBe("Mobile unit & widget tests (flutter test, coverage >= 70%)");
    for (const id of ["mobile.analyze", "mobile.unit", "mobile.build"]) expect(gate(id).env, id).toEqual({ FLUTTER_SUPPRESS_ANALYTICS: "true" });
    // the Dart SDK has no dependency audit, so there is no such gate, and the rules say to read pubspec.lock yourself
    expect(gates.map((g) => g.id)).not.toContain("mobile.audit");
    expect(textOf(only.files)(".ai/rules/security.md")).toContain("no audit gate for a Dart project");
    expect(textOf(full.files)(".ai/rules/security.md")).toContain("`backend.audit` and `web.audit` report known vulnerabilities");
    expect(textOf(full.files)(".ai/rules/security.md")).toContain("The Dart SDK has no dependency audit");
  });

  it("the coverage floor is configurable and lives in the protected gate config, not in a file the agent edits", () => {
    const strict = generate({ ...ONLY, sdlc: { coverage: { mobile: 85 } } });
    expect((sdlcOf(strict.files).gates as Json[]).find((g) => g.id === "mobile.unit")!.cmd).toContain("--min 85");
    expect(textOf(strict.files)(".ai/rules/testing.md")).toContain("mobile >= 85%");
    expect(textOf(full.files)(".ai/rules/testing.md")).toContain("backend >= 80%, web >= 70%, mobile >= 70%");
    expect(sdlcOf(only.files).integrity.protected).toContain(".ai/sdlc.json");
  });

  it("linting and type checking are one pass, so either switch keeps it, and both off drops it", () => {
    const ids = (gates: Json) => (sdlcOf(generate({ ...ONLY, sdlc: { gates } }).files).gates as Json[]).map((g) => g.id);
    expect(ids({ lint: false })).toContain("mobile.analyze");
    expect(ids({ types: false })).toContain("mobile.analyze");
    expect(ids({ lint: false, types: false })).not.toContain("mobile.analyze");
    expect(ids({ unit: false })).not.toContain("mobile.unit");
    expect(ids({ build: false })).not.toContain("mobile.build");
  });

  it("installs dependencies with the lockfile when there is one, and tells doctor to look for flutter", () => {
    const step = (sdlcOf(only.files).setup as Json[])[0]!;
    expect(step).toMatchObject({
      id: "mobile.install",
      component: "mobile",
      cwd: "mobile",
      toolchain: "flutter",
      cmd: "flutter pub get --enforce-lockfile",
      lockfile: "pubspec.lock",
      fallbackCmd: "flutter pub get",
      tools: ["flutter"],
      manifests: ["mobile/pubspec.yaml"],
      marker: "mobile/.dart_tool",
    });
    // the runner is generic: it learns what to look for from `tools` above, so it names no framework
    expect(textOf(full.files)("scripts/sdlc.py")).not.toMatch(/flutter/i);
    // the CI form of the same step (bash) chooses by the lockfile
    const ci = parse(textOf(full.files)(".github/workflows/ci.yml")) as Json;
    expect(ci.jobs.mobile.steps.find((s: Json) => s.name === "Install mobile dependencies (flutter pub get)")).toMatchObject({
      run: "if [ -f pubspec.lock ]; then flutter pub get --enforce-lockfile; else flutter pub get; fi",
      "working-directory": "mobile",
    });
  });

  it("pubspec.yaml pins the Flutter and Dart of the chosen release line, and keeps any description valid YAML", () => {
    const pubspec = (patch: Json) => parse(textOf(generate({ ...ONLY, ...patch }).files)("mobile/pubspec.yaml")) as Json;
    expect(pubspec({}).environment).toEqual({ sdk: "^3.14.0", flutter: ">=3.50.0" });
    expect(pubspec({ project: { name: "my-shop" } }).name).toBe("my_shop");
    const description = `Say "hi": it's {fine} # not a comment\nsecond line`;
    expect(pubspec({ project: { description } }).description).toBe(description);
    expect(pubspec({}).dependencies.material_ui).toMatch(/^\^1\./);
    expect(pubspec({}).flutter).toEqual({ "uses-material-design": true });
  });

  it("the spec's checks run a named test for every criterion, and that test exists", () => {
    for (const [label, result] of [["on its own", only], ["beside a web app", beside], ["with a backend", api], ["full stack", full]] as const) {
      const checks = (acceptanceOf(result.files).checks as Json[]).filter((c) => c.type === "cmd" && String(c.run).startsWith("flutter test"));
      expect(checks.length, label).toBeGreaterThan(0);
      for (const check of checks) {
        const match = /^flutter test (\S+) --plain-name "(AC-\d+)"/.exec(check.run as string);
        expect(match, `${label}: ${check.run}`).not.toBeNull();
        const [, file, ac] = match!;
        expect(check.cwd, label).toBe("mobile");
        expect(check.covers, label).toEqual([ac]);
        // flutter test exits 0 for a skipped test, so the check also requires that something passed
        expect(check.stdoutContains, label).toEqual(["All tests passed!"]);
        expect(check.env, label).toEqual({ FLUTTER_SUPPRESS_ANALYTICS: "true" });
        // the id begins a test name in that very file, so the name filter can never match nothing
        expect(textOf(result.files)(`mobile/${file}`), `${label}: ${file}`).toContain(`${ac}:`);
        expect(textOf(result.files)(`.ai/specs/FEAT-000-hello-world/prd.md`), label).toMatch(new RegExp(`\\*\\*${ac}\\*\\*`));
      }
    }
  });

  it("on its own it has three greeting criteria and needs no runtime; beside a web app they follow the web's three", () => {
    expect((acceptanceOf(only.files).checks as Json[]).map((c) => [c.id, c.covers[0], c.type])).toEqual([
      ["CHK-001", "AC-001", "cmd"], ["CHK-002", "AC-002", "cmd"], ["CHK-003", "AC-003", "cmd"],
    ]);
    expect((acceptanceOf(beside.files).checks as Json[]).map((c) => [c.id, c.covers[0], c.type])).toEqual([
      ["CHK-001", "AC-001", "http"], ["CHK-002", "AC-002", "http"], ["CHK-003", "AC-003", "http"],
      ["CHK-004", "AC-004", "cmd"], ["CHK-005", "AC-005", "cmd"], ["CHK-006", "AC-006", "cmd"],
    ]);
    expect(textOf(beside.files)("mobile/test/ui/hello_page_test.dart")).toContain("'AC-004: the first screen greets the world'");
    expect(textOf(beside.files)(".ai/specs/FEAT-000-hello-world/prd.md")).toContain("a mobile screen that does the same");
    expect(textOf(only.files)(".ai/specs/FEAT-000-hello-world/prd.md")).toContain("the Flutter app computes the greeting itself");
    expect(textOf(only.files)(".ai/specs/FEAT-000-hello-world/prd.md")).not.toMatch(/web/i);
    expect(sdlcOf(only.files).runtime.targets).toEqual({});
  });

  it("next to a backend one check runs the app's own client against the live API, which has to be up", () => {
    for (const result of [api, full]) {
      const check = (acceptanceOf(result.files).checks as Json[]).find((c) => c.id === "CHK-009")!;
      expect(check).toMatchObject({ covers: ["AC-008"], type: "cmd", needs: ["backend"], cwd: "mobile", expectExit: 0 });
      expect(check.run).toBe('flutter test test/integration/backend_test.dart --plain-name "AC-008" --dart-define=API_URL=http://127.0.0.1:8000');
      expect(check.timeoutSeconds).toBeGreaterThanOrEqual(300);
    }
    const test = textOf(api.files)("mobile/test/integration/backend_test.dart");
    expect(test).toContain("AC-008");
    expect(test).toContain("skip: _liveApi.isEmpty");
    expect(textOf(full.files)(".ai/specs/FEAT-000-hello-world/prd.md")).toContain("a web page and a mobile app that each display the greeting from the API");
    // the web criteria are untouched by the mobile one
    expect((acceptanceOf(full.files).checks as Json[]).find((c) => c.id === "CHK-008")).toMatchObject({ covers: ["AC-007"], target: "web" });
  });

  it("CI runs the gates in a mobile job with the SDK pinned to the release line, and the facts job has the SDK too", () => {
    const ci = parse(textOf(full.files)(".github/workflows/ci.yml")) as Json;
    expect(ci.jobs.mobile.env).toEqual({ FLUTTER_SUPPRESS_ANALYTICS: "true" });
    expect(ci.jobs.mobile.steps[1]).toEqual({ uses: "subosito/flutter-action@v2", with: { channel: "stable", "flutter-version": "3.50.x", cache: true } });
    expect(ci.jobs.mobile.steps.filter((s: Json) => s.run).map((s: Json) => s.run)).toEqual([
      "if [ -f pubspec.lock ]; then flutter pub get --enforce-lockfile; else flutter pub get; fi",
      "flutter analyze --fatal-infos && dart format --output=none --set-exit-if-changed .",
      "flutter test --coverage && dart run tool/check_coverage.dart --min 70",
      "flutter build bundle",
    ]);
    expect(ci.jobs.facts.needs).toEqual(expect.arrayContaining(["backend", "web", "mobile", "repo"]));
    expect(ci.jobs.facts.steps.some((s: Json) => s.uses === "subosito/flutter-action@v2")).toBe(true);
  });

  it("on its own CI still runs the facts (so a criterion without a check fails there too), without starting anything", () => {
    const ci = parse(textOf(only.files)(".github/workflows/ci.yml")) as Json;
    expect(Object.keys(ci.jobs).sort()).toEqual(["facts", "mobile", "repo"]);
    const runs = ci.jobs.facts.steps.map((s: Json) => s.run ?? s.uses);
    expect(runs).toContain("subosito/flutter-action@v2");
    expect(runs).toContain("python3 scripts/sdlc.py facts");
    expect(runs).not.toContain("python3 scripts/sdlc.py setup");
    // a web or backend project with no runtime still has no facts job (unchanged)
    expect(Object.keys((parse(textOf(generate({ sdlc: { runtime: "none" } }).files)(".github/workflows/ci.yml")) as Json).jobs)).not.toContain("facts");
  });

  it("with nothing to put in a container there is no compose file, no CD and no deploy script; with a backend the app is not an image", () => {
    const names = only.files.map((f) => f.path);
    expect(names).not.toContain("docker-compose.yml");
    expect(names).not.toContain(".github/workflows/cd.yml");
    expect(names).not.toContain("scripts/deploy.sh");
    expect(only.config).toMatchObject({ docker: { enabled: false }, cd: { enabled: false }, sdlc: { runtime: "none" } });
    expect(textOf(only.files)("scaffolder.config.yaml")).toMatch(/^docker:\n {2}enabled: false$/m);
    expect(sdlcOf(only.files).runtime.mode).toBe("none");
    expect(textOf(only.files)("README.md")).not.toMatch(/Docker|make up/);

    expect(Object.keys((parse(textOf(full.files)("docker-compose.yml")) as Json).services).sort()).toEqual(["backend", "postgres", "web"]);
    const cd = textOf(full.files)(".github/workflows/cd.yml");
    expect(cd).not.toMatch(/mobile/i);
  });

  it("the documents describe the app as Flutter, and the folders it generates are ignored and left out of the secret scan", () => {
    const own = textOf(only.files);
    expect(own("README.md")).toContain("Flutter (Dart) app whose first screen greets the user");
    expect(own("README.md")).toContain("Flutter 3.50 (Dart 3.14)");
    expect(textOf(api.files)("README.md")).toContain("Flutter (Dart) app that shows the greeting it fetches from the API");
    expect(own("AGENTS.md")).toContain("mobile/            Flutter app (Flutter 3.50, Dart 3.14)");
    expect(own("AGENTS.md")).toContain("(pubspec.yaml) changed");
    expect(textOf(full.files)("AGENTS.md")).toContain("(pyproject.toml / package.json / pubspec.yaml) changed");
    expect(own(".gitignore")).toMatch(/^\.dart_tool\/$/m);
    expect(own(".gitignore")).toMatch(/^mobile\/build\/$/m);
    expect(own("scripts/sdlc.py")).toMatch(/SECRET_SKIP_DIRS = \{[^}]*"\.dart_tool"/);
    expect(own(".github/dependabot.yml")).toMatch(/package-ecosystem: pub\n\s+directory: \/mobile/);
    expect(own(".ai/rules/mobile-flutter.md")).toContain("package:flutter/material.dart` is deprecated since Flutter 3.47");
    expect(own(".ai/rules/mobile-flutter.md")).toContain("flutter create --platforms=android,ios");
    expect(own(".ai/rules/mobile-flutter.md")).toContain("a file no test uses is a failure");
    expect(own(".ai/skills/implement-feature/SKILL.md")).toContain("Mobile (`mobile/`): see `.ai/rules/mobile-flutter.md`.");
    expect(own(".ai/prompts/spec.md")).toContain("`.ai/rules/mobile-flutter.md`");
    expect(own(".ai/prompts/spec.md")).toContain("flutter test test/ui/plans_page_test.dart --plain-name");
    expect(own(".ai/prompts/spec.md")).not.toContain("npx vitest");
    expect(JSON.parse(own(".ai/specs/_template/acceptance.json").replace("{{ID}}", "FEAT-001")).checks[0].type).toBe("cmd");
  });

  it("projects without a mobile app are not touched by Flutter being available", () => {
    const plain = generate({});
    expect(plain.config.mobile.enabled).toBe(false);
    for (const f of plain.files) {
      expect(f.path, f.path).not.toMatch(/mobile|flutter|\.dart$|pubspec/i);
      if (f.path === "scaffolder.config.yaml" || f.path === "scripts/sdlc.py") continue;
      expect(f.content, f.path).not.toMatch(/Flutter|flutter|pubspec|\.dart_tool|Dart /);
    }
    expect((sdlcOf(plain.files).gates as Json[]).some((g) => g.component === "mobile")).toBe(false);
    expect(sdlcOf(plain.files).setup.map((s: Json) => s.toolchain)).toEqual(["python", "node"]);
    expect(Object.keys((parse(textOf(plain.files)(".github/workflows/ci.yml")) as Json).jobs)).toEqual(["backend", "web", "repo", "facts"]);
    const next = (patch: Json) => generate({ web: { framework: "nuxt" }, ...patch });
    expect(textOf(next({}).files)(".gitignore")).not.toContain(".dart_tool");
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

  describe("Claude Code commands (.claude/skills/sdlc-*): the app is the agent, the tool is the judge", () => {
    const FAMILY = ["sdlc-doctor", "sdlc-setup", "sdlc-gates", "sdlc-verify", "sdlc-new", "sdlc-spec", "sdlc-implement"];
    const CONFIGS = [{}, { backend: { enabled: false }, database: { type: "none" } }, { web: { enabled: false } }];
    // the tool command each read-only skill may pre-approve, and nothing else
    const READ_ONLY: Record<string, string> = { "sdlc-doctor": "doctor", "sdlc-gates": "gates", "sdlc-verify": "verify" };

    const skillsOf = (cfg: Json) => {
      const { sdlc, files, agents } = sdlcOf(cfg);
      const text = (path: string) => files.find((f) => f.path === path)!.content;
      return { sdlc, agents, text, skill: (name: string) => text(`.claude/skills/${name}/SKILL.md`), files };
    };

    it("ships exactly the family, each in Claude Code's project-skill format", () => {
      for (const cfg of CONFIGS) {
        const { skill, files } = skillsOf(cfg);
        expect(files.filter((f) => f.path.startsWith(".claude/")).map((f) => f.path).sort()).toEqual(FAMILY.map((n) => `.claude/skills/${n}/SKILL.md`).sort());
        for (const name of FAMILY) {
          const md = skill(name);
          // the folder name makes the command; only the person can start it; nothing is left unrendered
          expect(md.startsWith(`---\nname: ${name}\ndescription: `), name).toBe(true);
          expect(/^description: (.+)$/m.exec(md)![1]!.length, `${name}: description`).toBeLessThan(260);
          expect(md, name).toContain("\ndisable-model-invocation: true\n");
          expect(md, name).not.toMatch(/<%|%>/);
          // the typed argument must never be spliced into a shell command by the app (the !`cmd` form)
          expect(md, name).not.toMatch(/!`/);
          // $ARGUMENTS is used exactly by the commands that take one
          expect(md.includes("$ARGUMENTS"), `${name}: $ARGUMENTS`).toBe(md.includes("\nargument-hint: "));
          // Windows PowerShell and cmd get the .cmd launcher
          expect(md, name).toContain(".\\scripts\\sdlc.cmd");
        }
      }
    });

    it("never takes a name Claude Code already uses: a project command with the same name replaces the built-in", () => {
      for (const name of FAMILY) expect(name.startsWith("sdlc-"), name).toBe(true);
    });

    it("pre-approves the least it needs: no history-writing git, no blanket tool, no deploy, and read-only ones only their own command", () => {
      const { skill } = skillsOf({});
      for (const name of FAMILY) {
        const allowed = /^allowed-tools: (.*)$/m.exec(skill(name))![1]!;
        expect(allowed, name).not.toMatch(/commit|push|reset|stash|deploy|Bash\(\*\)|Bash\(\.\/scripts\/sdlc \*\)/);
        const only = READ_ONLY[name];
        if (only) {
          const grants = allowed.match(/Bash\([^)]*\)/g) ?? [];
          expect(grants.length, `${name}: grants`).toBeGreaterThan(0);
          for (const grant of grants) expect(grant, `${name} grants ${grant}`).toMatch(new RegExp(`^Bash\\(\\./scripts/sdlc ${only}( \\*)?\\)$`));
        }
      }
      // the builders may only dry-run `implement` and `spec`: a real run would start another agent
      expect(/^allowed-tools: (.*)$/m.exec(skill("sdlc-implement"))![1]!).toContain("Bash(./scripts/sdlc implement * --dry-run *)");
      expect(/^allowed-tools: (.*)$/m.exec(skill("sdlc-spec"))![1]!).toContain("Bash(./scripts/sdlc spec * --dry-run *)");
    });

    it("only names tool commands that exist, and `implement` and `spec` only as a dry run", () => {
      for (const cfg of CONFIGS) {
        const { skill, text } = skillsOf(cfg);
        const real = new Set([...text("scripts/sdlc.py").matchAll(/add_parser\("([a-z]+)"\)/g)].map((m) => m[1]!));
        for (const name of FAMILY) {
          const md = skill(name);
          for (const m of md.matchAll(/\.\/scripts\/sdlc\s+([a-z]+)/g)) expect(real.has(m[1]!), `${name}: ./scripts/sdlc ${m[1]} is not a command`).toBe(true);
          for (const m of md.matchAll(/\.\/scripts\/sdlc (?:implement|spec) [^`\n]*/g)) expect(m[0], `${name}: "${m[0]}" would start another agent`).toContain("--dry-run");
        }
        expect(skill("sdlc-implement")).toContain("Run `./scripts/sdlc implement` without `--dry-run`");
      }
    });

    it("/sdlc-implement does what the CLI does around an agent, in order, with the project's own limits", () => {
      for (const cfg of CONFIGS) {
        const { sdlc, skill } = skillsOf(cfg);
        const md = skill("sdlc-implement");
        const order = ["## 0.", "## 1.", "sync", "`./scripts/sdlc gates` must be green", "--dry-run --agent claude", "## 4.", "`./scripts/sdlc verify`", "## 6."];
        let at = -1;
        for (const marker of order) {
          const next = md.indexOf(marker, at + 1);
          expect(next, `"${marker}" is missing or out of order`).toBeGreaterThan(at);
          at = next;
        }
        // the worked example is refused, like `sdlc implement FEAT-000` does
        expect(md).toMatch(/`FEAT-000` is the worked example[\s\S]*nothing to implement/);
        // the integrity check names only paths the tool really protects
        const protectedPaths = new Set(sdlc.integrity.protected as string[]);
        for (const path of [".ai/sdlc.json", "scripts/sdlc.py", ".github/workflows/"]) expect(protectedPaths.has(path), path).toBe(true);
        expect(md).toContain("git status --short -- .ai/sdlc.json scripts .github/workflows");
        expect(md).toContain("git hash-object");
        // the heal budget is the project's own
        expect(md).toContain(`${sdlc.loop.maxIterations} times`);
        expect(md).toContain(`${sdlc.loop.noProgressLimit} times in a row`);
      }
    });

    it("the read-only commands change nothing, and the spec writers write only the spec", () => {
      const { skill } = skillsOf({});
      expect(skill("sdlc-doctor")).toContain("changes nothing");
      expect(skill("sdlc-gates")).toContain("only reports");
      expect(skill("sdlc-verify")).toContain("only reports");
      // a stack that cannot start is the person's to fix, not a heal round for the agent
      for (const name of ["sdlc-verify", "sdlc-implement"]) expect(skill(name), name).toContain("Docker is not running");
      for (const name of ["sdlc-new", "sdlc-spec"]) {
        expect(skill(name), name).toMatch(/no code/i);
        expect(skill(name), name).toContain("Status: Accepted");
        expect(skill(name), name).toContain("/sdlc-implement FEAT-00N");
      }
    });

    it("the places people look list every command, and the AGENTS.md rule has the dry-run exception the skills rely on", () => {
      const { agents, text } = skillsOf({});
      for (const name of FAMILY) {
        expect(text("README.md"), `README: /${name}`).toContain(`\`/${name}`);
        expect(agents, `AGENTS.md: /${name}`).toContain(`/${name}`);
      }
      expect(agents).toContain("--dry-run` is fine");
      expect(agents).toContain("Do not run `./scripts/sdlc implement`, `spec`, `feature` or `loop` yourself");
      expect(text(".ai/README.md")).toContain("`/sdlc-implement FEAT-001`");
    });
  });

  it("README explains how to drive the project from a desktop app, with the commands that make it match the CLI", () => {
    for (const cfg of [{}, { backend: { enabled: false }, database: { type: "none" } }]) {
      const { files } = sdlcOf(cfg);
      const text = (path: string) => files.find((f) => f.path === path)!.content;
      const readme = text("README.md");
      expect(readme).toContain("## Use it from an AI desktop app");
      // Claude Code reads CLAUDE.md, Codex reads AGENTS.md; skills are linked per skill folder
      expect(readme).toContain("@AGENTS.md");
      expect(readme).toContain(".agents/skills");
      expect(readme).toContain(".claude/skills");
      // the exact prompt, the same loop with the app as the agent, and the integrity check the CLI does
      expect(readme).toContain("implement FEAT-001 --dry-run --agent claude");
      expect(readme).toContain('./scripts/sdlc loop --agent ""');
      expect(readme).toContain("git status --short -- .ai/specs .ai/sdlc.json scripts .github/workflows");
      expect(readme).not.toMatch(/<%|%>/);
      // an agent started from an app must not start another agent
      expect(text("AGENTS.md")).toContain("Do not run `./scripts/sdlc implement`, `spec`, `feature` or `loop` yourself");
    }
  });

  it("documents implement and sync where people look (AGENTS.md, README, Makefile, skills)", () => {
    const { files } = sdlcOf({});
    const text = (path: string) => files.find((f) => f.path === path)!.content;
    for (const path of ["AGENTS.md", "README.md"]) expect(text(path), path).toContain("./scripts/sdlc implement");
    expect(text("AGENTS.md")).toContain("./scripts/sdlc sync");
    expect(text("Makefile")).toMatch(/^implement:/m);
    expect(text(".ai/skills/write-prd/SKILL.md")).toContain("./scripts/sdlc implement");
  });

  it("refuses to implement the already-built worked example, and says when a run changed no file", () => {
    const { files } = sdlcOf({});
    const tool = files.find((f) => f.path === "scripts/sdlc.py")!.content;
    expect(tool).toContain('EXAMPLE_FEATURE = "FEAT-000"');
    expect(tool).toMatch(/if fid == EXAMPLE_FEATURE:[\s\S]*is the worked example[\s\S]*return EXIT_HUMAN/);
    expect(tool).toContain("changed no file");
    // the stopped run points at the commands that do build something
    const refusal = tool.slice(tool.indexOf("if fid == EXAMPLE_FEATURE:"), tool.indexOf("# 1. the spec is the contract"));
    for (const cmd of ["./scripts/sdlc verify", "./scripts/sdlc new", "./scripts/sdlc spec", "./scripts/sdlc implement FEAT-001"]) expect(refusal).toContain(cmd);
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
    for (const framework of ["react-native", "android", "ios"]) {
      expect(errorPaths({ mobile: { enabled: true, framework } }), framework).toContain("mobile.framework");
    }
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

  it("accepts a Flutter app on its own, with the default Docker and CD settings, and checks its version, folder and name", () => {
    expect(errorPaths({ backend: { enabled: false }, web: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } })).toEqual([]);
    expect(errorPaths({ mobile: { enabled: true, version: "3.1" } })).toEqual(["mobile.version"]);
    expect(errorPaths({ mobile: { enabled: true, version: "3.50" } })).toEqual([]);
    // only the release line that was run against is offered
    expect(errorPaths({ mobile: { enabled: true, version: "3.47" } })).toEqual(["mobile.version"]);
    expect(check({ mobile: { enabled: true, version: "3.47" } }).find((i) => i.path === "mobile.version")!.message).toBe("Flutter supports versions: 3.50.");
    expect(errorPaths({ mobile: { enabled: true }, layout: { mobileDir: "web" } })).toContain("layout.mobileDir");
    expect(errorPaths({ mobile: { enabled: true }, layout: { mobileDir: "backend" } })).toContain("layout.mobileDir");
    expect(errorPaths({ layout: { mobileDir: "../escape" } })).toContain("layout.mobileDir");
    expect(errorPaths({ sdlc: { coverage: { mobile: 101 } } })).toContain("sdlc.coverage.mobile");
  });

  it("refuses a project name that the app's package cannot have, only when there is a mobile app", () => {
    for (const name of ["class", "import", "for", "null", "web", "http", "path", "flutter", "async", "material-ui"]) {
      expect(errorPaths({ project: { name }, mobile: { enabled: true } }), name).toContain("project.name");
      expect(errorPaths({ project: { name } }), `${name} without mobile`).not.toContain("project.name");
    }
    // typedef and dynamic are accepted by pub, and an ordinary name that merely contains a reserved word is fine
    for (const name of ["typedef", "dynamic", "class-room", "my-shop", "a1"]) {
      expect(errorPaths({ project: { name }, mobile: { enabled: true } }), name).not.toContain("project.name");
    }
    const message = check({ project: { name: "web" }, mobile: { enabled: true } }).find((i) => i.path === "project.name")!.message;
    expect(message).toContain("cannot depend on itself");
    expect(message).toContain("Choose another project name");
  });

  it("leaves Docker, CD and the Docker runtime out of a project with no service to run in them", () => {
    const cfg = resolveConfig({ backend: { enabled: false }, web: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } });
    expect([cfg.docker.enabled, cfg.cd.enabled, cfg.sdlc.runtime]).toEqual([false, false, "none"]);
    // a runtime the person chose is theirs; and anything with a service keeps what it had
    expect(resolveConfig({ backend: { enabled: false }, web: { enabled: false }, mobile: { enabled: true }, sdlc: { runtime: "local" } }).sdlc.runtime).toBe("local");
    expect(resolveConfig({ mobile: { enabled: true } })).toMatchObject({ docker: { enabled: true }, cd: { enabled: true }, sdlc: { runtime: "docker" } });
    expect(resolveConfig({ web: { enabled: false } })).toMatchObject({ docker: { enabled: true }, cd: { enabled: true } });
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
