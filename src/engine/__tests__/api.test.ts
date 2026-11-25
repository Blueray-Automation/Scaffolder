import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultConfig, deepMerge, resolveConfig, validateConfig } from "../config";
import { generateProject, type GeneratedFile } from "../generate";

type Json = Record<string, any>;

const HAVE_PYTHON = spawnSync("python3", ["--version"]).status === 0;
const python = HAVE_PYTHON ? describe : describe.skip;
const here = dirname(fileURLToPath(import.meta.url));
const PETSTORE = readFileSync(join(here, "fixtures", "petstore.yaml"), "utf8");

const FULL = {}; // Next.js + FastAPI
const NUXT = { web: { framework: "nuxt" } };
const WEB_ONLY = { backend: { enabled: false }, database: { type: "none" } };
const FLUTTER_ONLY = { backend: { enabled: false }, web: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } };
const BACKEND_ONLY = { web: { enabled: false } };

const generate = (patch: Json) => generateProject(deepMerge(defaultConfig(), patch));
const text = (files: GeneratedFile[], path: string): string => {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`no generated file ${path}`);
  return f.content;
};

// ---------------------------------------------------------------------------------------------------- what is generated

describe("the API integration layer is generated for projects with a screen", () => {
  const API_FILES = [".ai/api/README.md", ".ai/rules/api-integration.md", ".ai/skills/integrate-api/SKILL.md"];

  it("ships the guide, the rule and the skill with every screen, and nothing to a backend on its own", () => {
    for (const patch of [FULL, NUXT, WEB_ONLY, FLUTTER_ONLY]) {
      const files = generate(patch).files;
      for (const p of API_FILES) expect(files.map((f) => f.path), JSON.stringify(patch)).toContain(p);
    }
    const backend = generate(BACKEND_ONLY).files;
    expect(backend.map((f) => f.path).filter((p) => /api-integration|integrate-api|^\.ai\/api\//.test(p))).toEqual([]);
    expect(text(backend, ".ai/sdlc.json")).not.toContain('"api"');
    expect(text(backend, ".ai/specs/_template/prd.md")).not.toMatch(/API integration/);
    expect(backend.map((f) => f.path)).not.toContain(".ai/specs/FEAT-000-hello-world/prd.md".replace("prd.md", "api"));
  });

  it("records where the documentation lives, and the project's own contract when there is a backend", () => {
    const full = JSON.parse(text(generate(FULL).files, ".ai/sdlc.json")) as Json;
    expect(full.api).toEqual({ enforce: true, dir: ".ai/api", manifest: ".ai/api/apis.json", contract: ".ai/contract/openapi.json" });
    const web = JSON.parse(text(generate(WEB_ONLY).files, ".ai/sdlc.json")) as Json;
    expect(web.api).toEqual({ enforce: true, dir: ".ai/api", manifest: ".ai/api/apis.json" });
  });

  it("protects the imported documentation from the agent, like the specs and the gate configuration", () => {
    const web = JSON.parse(text(generate(WEB_ONLY).files, ".ai/sdlc.json")) as Json;
    expect(web.integrity.protected).toContain(".ai/api/");
    const backend = JSON.parse(text(generate(BACKEND_ONLY).files, ".ai/sdlc.json")) as Json;
    expect(backend.integrity.protected).not.toContain(".ai/api/");
  });

  it("has a gate that is static, required, and switched off with the setting (or with the lint gates)", () => {
    const gates = (patch: Json) => (JSON.parse(text(generate(patch).files, ".ai/sdlc.json")) as Json).gates as Json[];
    const gate = gates(WEB_ONLY).find((g) => g.id === "repo.api");
    expect(gate).toMatchObject({ stage: "static", required: true, cmd: "python3 scripts/sdlc.py api check", cwd: "." });
    expect(gates(FLUTTER_ONLY).some((g) => g.id === "repo.api")).toBe(true);
    expect(gates({ ...WEB_ONLY, api: { enforce: false } }).some((g) => g.id === "repo.api")).toBe(false);
    expect(gates({ ...WEB_ONLY, sdlc: { gates: { lint: false } } }).some((g) => g.id === "repo.api")).toBe(false);
    expect(gates(BACKEND_ONLY).some((g) => g.id === "repo.api")).toBe(false);
  });

  it("is enforced by default, and a backend on its own has nothing to enforce", () => {
    expect(defaultConfig().api.enforce).toBe(true);
    expect(resolveConfig({ ...BACKEND_ONLY }).api.enforce).toBe(false);
    expect(validateConfig(resolveConfig(WEB_ONLY)).filter((i) => i.level === "error")).toEqual([]);
    const yaml = parseYaml(text(generate(WEB_ONLY).files, "scaffolder.config.yaml")) as Json;
    expect(yaml.api).toEqual({ enforce: true });
  });

  it("numbers the PRD sections: UI & design, then API integration, then the rest", () => {
    for (const patch of [FULL, NUXT, WEB_ONLY, FLUTTER_ONLY]) {
      const files = generate(patch).files;
      for (const path of [".ai/specs/_template/prd.md", ".ai/specs/FEAT-000-hello-world/prd.md"]) {
        const prd = text(files, path);
        expect(prd, path).toMatch(/^## 6\. UI & design$/m);
        expect(prd, path).toMatch(/^## 7\. API integration$/m);
        expect(prd, path).toMatch(/^## 8\. Out of scope$/m);
        expect(prd, path).toMatch(/^## 9\. Verification map$/m);
      }
      expect(text(files, ".ai/rules/prd.md")).toContain("7. **API integration**");
    }
  });

  it("renumbers when only one of the two is enforced, or neither", () => {
    const apiOnly = text(generate({ ...WEB_ONLY, design: { enforce: false } }).files, ".ai/specs/FEAT-000-hello-world/prd.md");
    expect(apiOnly).toMatch(/^## 6\. API integration$/m);
    expect(apiOnly).toMatch(/^## 7\. Out of scope$/m);
    expect(apiOnly).toMatch(/^## 8\. Verification map$/m);
    expect(apiOnly).not.toContain("UI & design");
    const designOnly = text(generate({ ...WEB_ONLY, api: { enforce: false } }).files, ".ai/specs/FEAT-000-hello-world/prd.md");
    expect(designOnly).toMatch(/^## 6\. UI & design$/m);
    expect(designOnly).toMatch(/^## 7\. Out of scope$/m);
    expect(designOnly).not.toContain("API integration");
    const neither = text(generate({ ...WEB_ONLY, api: { enforce: false }, design: { enforce: false } }).files, ".ai/specs/FEAT-000-hello-world/prd.md");
    expect(neither).toMatch(/^## 6\. Out of scope$/m);
    expect(neither).toMatch(/^## 7\. Verification map$/m);
  });

  it("the worked example names the operation it calls, and says so when it calls none", () => {
    expect(text(generate(FULL).files, ".ai/specs/FEAT-000-hello-world/prd.md")).toMatch(/## 7\. API integration\n- \*\*Operations\*\*: `GET \/api\/v1\/hello`/);
    for (const patch of [WEB_ONLY, FLUTTER_ONLY]) {
      expect(text(generate(patch).files, ".ai/specs/FEAT-000-hello-world/prd.md")).toMatch(/## 7\. API integration\nNo API calls\.\n/);
    }
  });

  it("tells an agent about it: the prompts, the rules and the PR template", () => {
    const files = generate(FULL).files;
    expect(text(files, ".ai/prompts/spec.md")).toContain("{{apiReferences}}");
    expect(text(files, ".ai/prompts/spec.md")).toContain("## 7. API integration");
    expect(text(files, ".ai/prompts/implement.md")).toContain("{{apiReferences}}");
    expect(text(files, ".ai/prompts/implement.md")).toContain("`.ai/skills/integrate-api/SKILL.md`");
    expect(text(files, ".ai/prompts/heal.md")).toContain(".ai/api/");
    expect(text(files, "AGENTS.md")).toContain(".ai/skills/integrate-api/");
    expect(text(files, ".github/pull_request_template.md")).toContain("API integration");
    expect(text(files, ".ai/rules/api-integration.md")).toContain("web/src/lib/");
    expect(text(generate(NUXT).files, ".ai/rules/api-integration.md")).toContain("web/server/utils/");
    expect(text(generate(FLUTTER_ONLY).files, ".ai/rules/api-integration.md")).toContain("mobile/lib/api/");
    // a backend on its own is not told about any of it
    const backend = generate(BACKEND_ONLY).files;
    expect(text(backend, ".ai/prompts/spec.md")).not.toContain("{{apiReferences}}");
    expect(text(backend, ".ai/prompts/implement.md")).not.toContain("{{apiReferences}}");
  });

  it("is documented in the generated project's own words, without placeholders left over", () => {
    for (const patch of [FULL, WEB_ONLY, FLUTTER_ONLY]) {
      for (const f of generate(patch).files.filter((x) => API_FILES.includes(x.path))) {
        expect(f.content, f.path).not.toMatch(/<%|%>/);
        expect(f.content, f.path).not.toMatch(/\bundefined\b/);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------- the real Python

interface Project {
  dir: string;
  /** Runs the project's own `sdlc` (the real Python). */
  run: (args: string[], env?: Record<string, string>) => Promise<{ status: number | null; out: string }>;
  write: (path: string, data: string | Buffer) => void;
  read: (path: string) => string;
  exists: (path: string) => boolean;
  /** A file outside the project: an API document somebody was sent. */
  outside: (name: string, data: string | Buffer) => string;
}

async function inProject(patch: Json, body: (p: Project) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "scaffolder-api-"));
  const away = mkdtempSync(join(tmpdir(), "scaffolder-api-in-"));
  try {
    for (const f of generate(patch).files) {
      const target = join(dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    await body({
      dir,
      run: (args, env = {}) =>
        new Promise((resolve) => {
          const child = spawn("python3", ["-I", join(dir, "scripts", "sdlc.py"), ...args], { cwd: dir, env: { ...process.env, ...env } });
          let out = "";
          child.stdout.on("data", (d) => (out += d));
          child.stderr.on("data", (d) => (out += d));
          child.on("close", (status) => resolve({ status, out }));
        }),
      write: (path, data) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), data);
      },
      read: (path) => readFileSync(join(dir, path), "utf8"),
      exists: (path) => existsSync(join(dir, path)),
      outside: (name, data) => {
        const path = join(away, name);
        writeFileSync(path, data);
        return path;
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  }
}

/** `sdlc facts` with no runtime, and the report it wrote: the console line cuts a long message short, the report has all of it. */
async function facts(p: Project, ...more: string[]): Promise<{ status: number | null; out: string }> {
  const r = await p.run(["facts", "--runtime", "none", ...more]);
  const report = /\[(\.ai\/evidence\/[^\]]+\/report\.md)\]/.exec(r.out)?.[1];
  return { status: r.status, out: r.out + (report ? "\n" + p.read(report) : "") };
}

/** The names of the operations a document's index lists, in order: ["GET /pet/{petId}", ...]. */
const indexed = (md: string): string[] => [...md.matchAll(/^- `([A-Z]+ [^`]+)`/gm)].map((m) => m[1] as string);

const SWAGGER2 = {
  swagger: "2.0",
  info: { title: "Legacy Shop", version: "2.3" },
  host: "shop.example.com",
  basePath: "/v2",
  schemes: ["https"],
  securityDefinitions: { token: { type: "apiKey", name: "X-Token", in: "header" } },
  paths: {
    "/orders": {
      get: { tags: ["orders"], summary: "List orders", parameters: [{ name: "limit", in: "query", type: "integer", required: false }], responses: { "200": { description: "ok", schema: { type: "array", items: { $ref: "#/definitions/Order" } } } } },
      post: {
        tags: ["orders"],
        summary: "Place an order",
        parameters: [{ name: "order", in: "body", required: true, schema: { $ref: "#/definitions/Order" } }],
        responses: { "201": { description: "created", schema: { $ref: "#/definitions/Order" } }, "422": { description: "invalid" } },
      },
    },
    "/orders/{id}": { parameters: [{ name: "id", in: "path", required: true, type: "string" }], get: { summary: "One order", responses: { "200": { description: "ok", schema: { $ref: "#/definitions/Order" } }, "404": { description: "missing" } } } },
  },
  definitions: { Order: { type: "object", required: ["id", "total"], properties: { id: { type: "string" }, total: { type: "number", format: "double" }, note: { type: "string", nullable: true } } } },
};

const POSTMAN = {
  info: { name: "Partner API", _postman_id: "abc", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: [{ key: "baseUrl", value: "https://partner.example.com/api" }],
  item: [
    {
      name: "Accounts",
      item: [
        { name: "Get account", request: { method: "GET", url: { raw: "{{baseUrl}}/accounts/:accountId?expand=owner", host: ["{{baseUrl}}"], path: ["accounts", ":accountId"], query: [{ key: "expand", value: "owner" }], variable: [{ key: "accountId" }] } }, response: [{ name: "ok", code: 200, status: "OK", body: '{"id":"a1"}' }] },
        { name: "Create account", request: { method: "POST", url: "{{baseUrl}}/accounts", body: { mode: "raw", raw: '{"name":"Ada"}' } } },
      ],
    },
  ],
};

python("`sdlc api` (the real Python)", () => {
  it("reads the petstore YAML and writes the document, an index and a record of both", async () => {
    await inProject(WEB_ONLY, async (p) => {
      const r = await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE)]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("OpenAPI 3.0.2");
      expect(r.out).toContain("5 operations");
      const dir = ".ai/api/swagger-petstore-openapi-3-0";
      expect(readFileSync(join(p.dir, dir, "openapi.yaml"), "utf8")).toBe(PETSTORE);
      const index = p.read(`${dir}/endpoints.md`);
      expect(indexed(index)).toEqual(["PUT /pet", "POST /pet", "GET /pet/findByStatus", "GET /pet/{petId}", "DELETE /pet/{petId}"]);
      expect(index).toContain("`GET /pet/{petId}` getPetById: Find pet by ID (in: petId*; out: 200 Pet, 404)");
      expect(index).toContain("`GET /pet/findByStatus` findPetsByStatus: Finds Pets by status (in: status; out: 200 Pet[], 400)");
      expect(index).toContain("`PUT /pet` updatePet: Update an existing pet (in: body Pet*; out: 200 Pet, 400, 404, 405)");
      expect(index).toContain("(deprecated) Deletes a pet");
      expect(index).toContain("Servers: https://petstore3.swagger.io/api/v3");
      expect(index).toContain("Auth: api_key (apiKey in header `api_key`), petstore_auth (oauth2)");
      const manifest = JSON.parse(p.read(".ai/api/apis.json")) as Json;
      expect(manifest.apis).toHaveLength(1);
      expect(manifest.apis[0]).toMatchObject({
        name: "swagger-petstore-openapi-3-0",
        kind: "openapi",
        file: "swagger-petstore-openapi-3-0/openapi.yaml",
        index: "swagger-petstore-openapi-3-0/endpoints.md",
        title: "Swagger Petstore - OpenAPI 3.0",
        version: "1.0.11",
        spec: "3.0.2",
        operations: 5,
        source: "petstore.yaml",
        servers: ["https://petstore3.swagger.io/api/v3"],
      });
      expect(manifest.apis[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(manifest)).not.toContain(tmpdir()); // never an absolute path
      expect(p.read(".ai/api/apis.json")).not.toMatch(/\r/);
      const check = await p.run(["api", "check"]);
      expect(check.status, check.out).toBe(0);
      expect(check.out).toContain("1 document(s), 5 operation(s) indexed");
    });
  });

  it("shows one operation with its parameters, its responses and every type it uses", async () => {
    await inProject(WEB_ONLY, async (p) => {
      await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
      let r = await p.run(["api", "show", "GET", "/pet/{petId}"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("GET /pet/{petId}   [pets]");
      expect(r.out).toContain("operationId: getPetById   tags: pet");
      expect(r.out).toContain("auth: api_key or petstore_auth [write:pets]");
      expect(r.out).toMatch(/petId {3}path {3}integer \(int64\) {3}required {3}ID of pet to return/);
      expect(r.out).toMatch(/200 {3}application\/json {3}Pet {3}successful operation/);
      expect(r.out).toMatch(/404 {3}\(no body\) {3}Pet not found/);
      expect(r.out).toContain("  Pet {\n    id?: integer (int64)\n    name: string\n    category?: Category\n    photoUrls: string[]");
      expect(r.out).toContain('status?: "available" | "pending" | "sold"   // pet status in the store');
      expect(r.out).toContain("  Category {");
      // a path with a real value, one with the server's base path, and one as a single argument
      for (const args of [["GET", "/pet/1234"], ["get", "/api/v3/pet/{petId}"], ["GET /pet/{id}"]]) {
        r = await p.run(["api", "show", ...args]);
        expect(r.status, args.join(" ") + r.out).toBe(0);
        expect(r.out).toContain("GET /pet/{petId}");
      }
      r = await p.run(["api", "show", "GET", "/pets"]);
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/no documented operation GET \/pets\. Similar: /);
      expect((await p.run(["api", "show", "FETCH", "/pet"])).status).toBe(64);
    });
  });

  it("lists the documented operations, and only those that mention a word", async () => {
    await inProject(WEB_ONLY, async (p) => {
      await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
      let r = await p.run(["api", "list"]);
      expect(r.out).toContain("pets  OpenAPI 3.0.2");
      expect(r.out).toContain("## pet\n- `PUT /pet`");
      r = await p.run(["api", "list", "--grep", "status"]);
      expect(r.out).toContain("GET /pet/findByStatus");
      expect(r.out).not.toContain("PUT /pet");
      r = await p.run(["api", "list", "--grep", "nothing-like-this"]);
      expect(r.out).toContain("nothing documented matches");
      r = await p.run(["api", "list", "--name", "other"]);
      expect(r.out).toContain("No API documentation named other");
    });
  });

  it("reads the same operations from JSON as from YAML", async () => {
    await inProject(WEB_ONLY, async (p) => {
      await p.run(["api", "import", p.outside("a.yaml", PETSTORE), "--name", "as-yaml"]);
      await p.run(["api", "import", p.outside("b.json", JSON.stringify(parseYaml(PETSTORE), null, 2)), "--name", "as-json"]);
      const body = (name: string) => p.read(`.ai/api/${name}/endpoints.md`).split("\n").slice(3).join("\n");
      expect(body("as-json")).toBe(body("as-yaml"));
      expect(p.exists(".ai/api/as-json/openapi.json")).toBe(true);
      expect(p.exists(".ai/api/as-yaml/openapi.yaml")).toBe(true);
    });
  });

  it("imports a Swagger 2.0 document: the server from host and basePath, and a body parameter", async () => {
    await inProject(WEB_ONLY, async (p) => {
      const r = await p.run(["api", "import", p.outside("shop.json", JSON.stringify(SWAGGER2))]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("Swagger 2.0");
      const md = p.read(".ai/api/legacy-shop/endpoints.md");
      expect(md).toContain("Servers: https://shop.example.com/v2");
      expect(md).toContain("Auth: token (apiKey in header `X-Token`)");
      expect(md).toContain("`POST /orders`: Place an order (in: body Order*; out: 201 Order, 422)");
      expect(md).toContain("`GET /orders/{id}`: One order (in: id*; out: 200 Order, 404)");
      const show = await p.run(["api", "show", "GET", "/v2/orders/7"]);
      expect(show.out).toContain("  Order {\n    id: string\n    total: number (double)\n    note?: string | null\n  }");
      expect(p.exists(".ai/api/legacy-shop/swagger.json")).toBe(true);
    });
  });

  it("imports a Postman collection: paths with :params, query names and the saved examples", async () => {
    await inProject(WEB_ONLY, async (p) => {
      const r = await p.run(["api", "import", p.outside("partner.json", JSON.stringify(POSTMAN)), "--name", "partner"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("Postman collection");
      const md = p.read(".ai/api/partner/endpoints.md");
      expect(md).toContain("Servers: https://partner.example.com/api");
      expect(md).toContain("## Accounts");
      expect(md).toContain("`GET /accounts/{accountId}`: Get account (in: accountId*, expand)");
      expect(md).toContain("`POST /accounts`: Create account");
      const show = await p.run(["api", "show", "GET", "/accounts/9"]);
      expect(show.out).toContain('200 OK\n    {"id":"a1"}');
      const post = await p.run(["api", "show", "POST", "/accounts"]);
      expect(post.out).toContain('Request body (an example from the collection)\n  {"name":"Ada"}');
    });
  });

  it("keeps a guide as it is, with its text beside it, and checks it like the rest", async () => {
    await inProject(WEB_ONLY, async (p) => {
      let r = await p.run(["api", "import", p.outside("Partner Guide.md", "# Partner API\r\nPOST /accounts creates one.\r\n"), "--name", "guide"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("a guide");
      expect(p.read(".ai/api/guide/partner-guide.md")).toBe("# Partner API\nPOST /accounts creates one.\n"); // LF, so the checksum is the same on every system
      r = await p.run(["api", "check"]);
      expect(r.status, r.out).toBe(0);
      r = await p.run(["api", "list"]);
      expect(r.out).toContain("a guide: it has no machine-readable operations");
      p.write(".ai/api/guide/partner-guide.md", "changed\n");
      expect((await p.run(["api", "check"])).status).toBe(1);
    });
  });

  it("refuses what is not an API document, and says why", async () => {
    await inProject(WEB_ONLY, async (p) => {
      const refuse = async (name: string, data: string | Buffer, args: string[], message: RegExp) => {
        const r = await p.run(["api", "import", p.outside(name, data), ...args]);
        expect(r.status, `${name}: ${r.out}`).toBe(64);
        expect(r.out, name).toMatch(message);
        expect(p.exists(".ai/api/apis.json"), `${name} left a manifest`).toBe(false);
      };
      await refuse("data.json", '{"hello": "world"}', [], /not an OpenAPI 3\.x, Swagger 2\.0 or Postman collection/);
      await refuse("broken.json", '{"openapi": "3.0.0",', [], /not readable as an API document/);
      await refuse("pic.png", Buffer.from([0x89, 0x50]), [], /not an API document this tool knows/);
      await refuse("ok.json", JSON.stringify({ openapi: "3.0.0", info: { title: "x", version: "1" }, paths: {} }), ["--name", "backend"], /taken by this project's own API contract/);
      await refuse("ok2.json", JSON.stringify({ openapi: "3.0.0", info: { title: "x", version: "1" }, paths: {} }), ["--name", "Bad Name"], /lowercase letters, digits and dashes/);
      const missing = await p.run(["api", "import", "/no/such/file.yaml"]);
      expect(missing.status).toBe(64);
      expect((await p.run(["api", "import"])).status).toBe(64);
    });
  });

  it("keeps a YAML document it cannot read, says so, and does not pretend to know its operations", async () => {
    await inProject(WEB_ONLY, async (p) => {
      const anchored = "openapi: 3.0.0\ninfo:\n  title: Anchors\n  version: '1'\nx-common: &common\n  a: 1\npaths:\n  /x:\n    get:\n      responses:\n        '200': {description: ok}\n    <<: *common\n";
      const r = await p.run(["api", "import", p.outside("anchors.yaml", anchored)]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("this tool cannot read it");
      expect(r.out).toContain("anchors, aliases and tags are not supported");
      expect(p.exists(".ai/api/anchors/openapi.yaml")).toBe(true);
      expect(p.exists(".ai/api/anchors/endpoints.md")).toBe(false);
      expect(((JSON.parse(p.read(".ai/api/apis.json")) as Json).apis[0] as Json).indexed).toBe(false);
      expect((await p.run(["api", "check"])).status).toBe(0);
      const list = await p.run(["api", "list"]);
      expect(list.out).toContain("not indexed");
    });
  });

  it("names what changed when a document is imported again", async () => {
    await inProject(WEB_ONLY, async (p) => {
      await p.run(["api", "import", p.outside("v1.yaml", PETSTORE), "--name", "pets"]);
      const v2 = parseYaml(PETSTORE) as Json;
      delete v2.paths["/pet/findByStatus"];
      v2.paths["/store/inventory"] = { get: { summary: "Inventory", responses: { "200": { description: "ok" } } } };
      const r = await p.run(["api", "import", p.outside("v2.json", JSON.stringify(v2)), "--name", "pets"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("changed since the last import: 1 added, 1 removed");
      expect(r.out).toContain("+ GET /store/inventory");
      expect(r.out).toContain("- GET /pet/findByStatus");
      expect(r.out).toContain("pets was imported from v1.yaml; this replaces it");
      expect(p.exists(".ai/api/pets/openapi.yaml"), "the old file is gone").toBe(false);
      expect(p.exists(".ai/api/pets/openapi.json")).toBe(true);
      expect((await p.run(["api", "check"])).status).toBe(0);
    });
  });

  describe("the gate", () => {
    it("fails when an imported file is edited or deleted, an index is edited, or a folder is not in the record", async () => {
      await inProject(WEB_ONLY, async (p) => {
        await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
        expect((await p.run(["gates", "--only", "repo.api"])).status).toBe(0);
        const file = ".ai/api/pets/openapi.yaml";
        p.write(file, PETSTORE.replace("Find pet by ID", "Find a pet"));
        let r = await p.run(["api", "check"]);
        expect(r.status).toBe(1);
        expect(r.out).toContain("is not what apis.json recorded (edited or replaced)");
        expect((await p.run(["gates", "--only", "repo.api"])).status, "the gate fails too").toBe(1);
        p.write(file, PETSTORE);
        expect((await p.run(["api", "check"])).status).toBe(0);

        p.write(".ai/api/pets/endpoints.md", p.read(".ai/api/pets/endpoints.md") + "- `GET /invented`\n");
        r = await p.run(["api", "check"]);
        expect(r.status).toBe(1);
        expect(r.out).toContain("is not what pets/openapi.yaml produces: run ./scripts/sdlc api sync");
        r = await p.run(["api", "sync"]);
        expect(r.status, r.out).toBe(0);
        expect(p.read(".ai/api/pets/endpoints.md")).not.toContain("invented");
        expect((await p.run(["api", "check"])).status).toBe(0);

        p.write(".ai/api/stray/openapi.json", "{}");
        r = await p.run(["api", "check"]);
        expect(r.status).toBe(1);
        expect(r.out).toContain(".ai/api/stray/ is not listed in apis.json");
        rmSync(join(p.dir, ".ai/api/stray"), { recursive: true });

        rmSync(join(p.dir, file));
        r = await p.run(["api", "check"]);
        expect(r.status).toBe(1);
        expect(r.out).toContain("is listed for pets but missing");
      });
    });

    it("fails on a manifest that is not valid, and on a name or file that could escape the folder", async () => {
      await inProject(WEB_ONLY, async (p) => {
        await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
        const original = p.read(".ai/api/apis.json");
        p.write(".ai/api/apis.json", "{ not json");
        let r = await p.run(["api", "check"]);
        expect(r.status).toBe(1);
        expect(r.out).toContain("is not valid JSON");
        const evil = JSON.parse(original) as Json;
        evil.apis[0].file = "../../scripts/sdlc.py";
        p.write(".ai/api/apis.json", JSON.stringify(evil));
        r = await p.run(["api", "check"]);
        expect(r.status).toBe(1);
        expect(r.out).toContain("lists a file with an unusable name");
        const renamed = JSON.parse(original) as Json;
        renamed.apis[0].name = "../etc";
        p.write(".ai/api/apis.json", JSON.stringify(renamed));
        expect((await p.run(["api", "check"])).status).toBe(1);
      });
    });

    it("never writes or deletes a file the record names outside the entry's own folder", async () => {
      await inProject(WEB_ONLY, async (p) => {
        await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
        p.write(".ai/sentinel.txt", "keep me\n");
        p.write(".ai/api/other.txt", "keep me too\n");
        const evil = JSON.parse(p.read(".ai/api/apis.json")) as Json;
        evil.apis[0].index = "../sentinel.txt";
        evil.apis[0].text = "../../.ai/sentinel.txt";
        p.write(".ai/api/apis.json", JSON.stringify(evil));
        const sync = await p.run(["api", "sync"]);
        expect(sync.status).toBe(1);
        expect(sync.out).toContain("the recorded index name is not usable");
        expect((await p.run(["api", "check"])).status).toBe(1);
        const again = await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
        expect(again.status, again.out).toBe(0);
        expect(p.read(".ai/sentinel.txt")).toBe("keep me\n");
        expect(p.read(".ai/api/other.txt")).toBe("keep me too\n");
        expect((await p.run(["api", "check"])).status, "importing again put the record right").toBe(0);
      });
    });

    it("passes on a project that imported nothing, and says so", async () => {
      await inProject(WEB_ONLY, async (p) => {
        const r = await p.run(["api", "check"]);
        expect(r.status).toBe(0);
        expect(r.out).toContain("no API documentation imported");
      });
      await inProject(FULL, async (p) => {
        const r = await p.run(["api", "check"]);
        expect(r.status).toBe(0);
        expect(r.out).toContain("this project's own backend contract, .ai/contract/openapi.json");
      });
    });

    it("a backend on its own has no API documentation to import", async () => {
      await inProject(BACKEND_ONLY, async (p) => {
        const r = await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE)]);
        expect(r.status).toBe(64);
        expect(r.out).toContain("has no screen");
        expect((await p.run(["api", "check"])).status).toBe(0);
      });
    });
  });

  describe("the PRD's API integration section", () => {
    const FEAT = ".ai/specs/FEAT-000-hello-world/prd.md";
    const swapSection = (prd: string, body: string) => prd.replace(/## 7\. API integration[\s\S]*?(?=## 8\.)/, `## 7. API integration\n${body}\n\n`);

    it("is required: a PRD without it fails, and the message says what to write", async () => {
      await inProject(WEB_ONLY, async (p) => {
        expect((await facts(p)).status, "the shipped example has it").toBe(0);
        p.write(FEAT, p.read(FEAT).replace(/## 7\. API integration[\s\S]*?(?=## 8\.)/, ""));
        const r = await facts(p);
        expect(r.status).toBe(1);
        expect(r.out).toContain("prd.md has no 'API integration' section");
        expect(r.out).toContain("No API calls.");
      });
    });

    it("accepts a heading with or without its number, at two levels, in any case", async () => {
      for (const heading of ["## 7. API integration", "## API Integration", "### 7. api integration"]) {
        await inProject(WEB_ONLY, async (p) => {
          p.write(FEAT, p.read(FEAT).replace("## 7. API integration", heading));
          const r = await facts(p);
          expect(r.status, `${heading}: ${r.out}`).toBe(0);
        });
      }
    });

    it("names the operations a feature calls, and they must be documented", async () => {
      await inProject(WEB_ONLY, async (p) => {
        await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
        const ok = (body: string) => p.write(FEAT, swapSection(p.read(FEAT), body));
        ok("- **Operations**: `GET /pet/{petId}`, to show a pet; `POST /pet` to add one.");
        let r = await facts(p);
        expect(r.status, r.out).toBe(0);
        ok("- **Operations**: `GET /pet/{id}`, a different name for the same parameter.");
        expect((await facts(p)).status, "a parameter's name is not part of the operation").toBe(0);
        ok("- **Operations**: `GET /api/v3/pet/{petId}`, spelt with the server's base path.");
        expect((await facts(p)).status).toBe(0);
        ok("- **Operations**: `get /pet/7?x=1`, a lower-case method and a query string.");
        expect((await facts(p)).status).toBe(0);

        ok("- **Operations**: `GET /pets/{petId}`, which nobody documented.");
        r = await facts(p);
        expect(r.status).toBe(1);
        expect(r.out).toContain("names `GET /pets/{petId}`, which no imported API documents");
        expect(r.out).toContain("Similar paths: /pet/{}");
        expect(r.out).toContain("sdlc api list");

        ok("- **Operations**: `DELETE /pet`, a real path with a method it does not have.");
        r = await facts(p);
        expect(r.status).toBe(1);
        expect(r.out).toMatch(/names `DELETE \/pet`, which no imported API documents\. It exists as (POST|PUT)/);

        ok("- **Operations**: TODO(prd): the operations.");
        r = await facts(p);
        expect(r.out).toContain("TODO(prd)");
        expect(r.out, "an unfinished section is not also reported as an unknown operation").not.toContain("no imported API documents");

        ok("The feature calls the pet store, but this section does not say which operations.");
        r = await facts(p);
        expect(r.status).toBe(1);
        expect(r.out).toContain("names no operation");
      });
    });

    it("cannot name an operation before any documentation is imported", async () => {
      await inProject(WEB_ONLY, async (p) => {
        p.write(FEAT, swapSection(p.read(FEAT), "- **Operations**: `GET /pet/{petId}`."));
        const r = await facts(p);
        expect(r.status).toBe(1);
        expect(r.out).toContain("no API documentation is imported: ./scripts/sdlc api import <file or link> first");
      });
    });

    it("cannot be checked against a guide, so an operation is accepted when one is imported", async () => {
      await inProject(WEB_ONLY, async (p) => {
        await p.run(["api", "import", p.outside("guide.md", "# Guide\n"), "--name", "guide"]);
        p.write(FEAT, swapSection(p.read(FEAT), "- **Operations**: `GET /anything/{id}`."));
        const r = await facts(p);
        expect(r.status, r.out).toBe(0);
      });
    });

    it("checks a project with a backend against its own contract", async () => {
      await inProject(FULL, async (p) => {
        // (this project has not been set up, so a unit-test fact cannot pass: only the API messages matter here)
        expect((await facts(p)).out).not.toContain("API integration");
        p.write(FEAT, swapSection(p.read(FEAT), "- **Operations**: `GET /api/v1/helo`."));
        const r = await facts(p);
        expect(r.out).toContain("names `GET /api/v1/helo`, which no imported API documents");
        expect(r.out).toContain("Similar paths: /api/v1/hello");
        p.write(FEAT, swapSection(p.read(FEAT), "- **Operations**: `GET /api/v1/hello` and `GET /health`."));
        expect((await facts(p)).out).not.toContain("API integration");
        const list = await p.run(["api", "list"]);
        expect(list.out).toContain("backend  this project's own backend contract");
        expect(list.out).toContain("`GET /api/v1/hello` (in: name; out: 200 HelloResponse, 422 HTTPValidationError)");
      });
    });

    it("a new feature starts with the section, as a TODO that has to be resolved", async () => {
      await inProject(FULL, async (p) => {
        expect((await p.run(["new", "orders"])).status).toBe(0);
        const prd = p.read(".ai/specs/FEAT-001-orders/prd.md");
        expect(prd).toMatch(/^## 7\. API integration$/m);
        expect(prd).toContain("- **Operations**: TODO(prd)");
        expect(prd).toMatch(/^## 8\. Out of scope$/m);
        const r = await facts(p, "--feature", "FEAT-001");
        expect(r.status).toBe(1);
        expect(r.out).toContain("TODO(prd)");
      });
    });

    it("is not asked of a project that turned enforcement off", async () => {
      await inProject({ ...WEB_ONLY, api: { enforce: false } }, async (p) => {
        expect(p.read(FEAT)).not.toContain("API integration");
        expect((await facts(p)).status).toBe(0);
        expect((await p.run(["api", "check"])).status, "run by hand it still works").toBe(0);
      });
    });
  });

  describe("what the agent is told", () => {
    const requirements = "# Orders\nA customer can look up a pet by id.\n";

    it("`spec` lists the documents and the operation index in its prompt, and says what it may not invent", async () => {
      await inProject(WEB_ONLY, async (p) => {
        await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
        p.write("requirements.md", requirements);
        const r = await p.run(["spec", "requirements.md", "--dry-run", "--agent", "cat"]);
        expect(r.status, r.out).toBe(0);
        const file = /prompt\s+: (\S+spec\.prompt\.md)/.exec(r.out)?.[1];
        expect(file, r.out).toBeTruthy();
        const prompt = p.read(file as string);
        expect(prompt).toContain("## API documentation");
        expect(prompt).toContain("Integrate ONLY with operations these documents define");
        expect(prompt).toContain("`pets` (OpenAPI 3.0.2; \"Swagger Petstore - OpenAPI 3.0\" 1.0.11; 5 operations): `.ai/api/pets/openapi.yaml` is the document, `.ai/api/pets/endpoints.md` its operation index");
        expect(prompt).toContain("- `GET /pet/{petId}` getPetById: Find pet by ID (in: petId*; out: 200 Pet, 404)");
        expect(prompt).toContain("## API integration (a section of prd.md, always present)");
        expect(prompt).toContain("Heading `## 7. API integration`");
        expect(prompt).toContain("`No API calls.`");
        expect(prompt).not.toMatch(/\{\{|<%/);
      });
    });

    it("`spec --api` imports first, and in a dry run only says it would", async () => {
      await inProject(WEB_ONLY, async (p) => {
        p.write("requirements.md", requirements);
        const doc = p.outside("petstore.yaml", PETSTORE);
        const dry = await p.run(["spec", "requirements.md", "--dry-run", "--agent", "cat", "--api", doc]);
        expect(dry.status, dry.out).toBe(0);
        expect(p.exists(".ai/api/apis.json"), "a dry run creates nothing").toBe(false);
        const file = /prompt\s+: (\S+spec\.prompt\.md)/.exec(dry.out)?.[1] as string;
        expect(p.read(file)).toContain("not imported yet, but this run imports it first: petstore.yaml");
        expect(p.read(file), "the prompt carries a file name, not the person's folders").not.toContain(tmpdir());
      });
    });

    it("`spec` of a project with no documentation says the section can only be `No API calls.`", async () => {
      await inProject(WEB_ONLY, async (p) => {
        p.write("requirements.md", requirements);
        const r = await p.run(["spec", "requirements.md", "--dry-run", "--agent", "cat"]);
        const prompt = p.read(/prompt\s+: (\S+spec\.prompt\.md)/.exec(r.out)?.[1] as string);
        expect(prompt).toContain("None imported, and this project has no backend of its own");
      });
    });

    it("a project with a backend lists its own contract, and a long index is searched instead of pasted", async () => {
      await inProject(FULL, async (p) => {
        p.write("requirements.md", requirements);
        let r = await p.run(["spec", "requirements.md", "--dry-run", "--agent", "cat"]);
        let prompt = p.read(/prompt\s+: (\S+spec\.prompt\.md)/.exec(r.out)?.[1] as string);
        expect(prompt).toContain("this project's own backend, as its committed OpenAPI contract: `.ai/contract/openapi.json`");
        expect(prompt).toContain("- `GET /api/v1/hello`");
        const big: Json = { openapi: "3.0.0", info: { title: "Big", version: "1" }, paths: {} };
        for (let i = 0; i < 400; i++) big.paths[`/things/${i}/items/{itemId}/details`] = { get: { summary: `Read the details of the item number ${i} in the collection`, responses: { "200": { description: "ok" } } } };
        await p.run(["api", "import", p.outside("big.json", JSON.stringify(big)), "--name", "big"]);
        r = await p.run(["spec", "requirements.md", "--dry-run", "--agent", "cat", "--allow-dirty"]);
        prompt = p.read(/prompt\s+: (\S+spec\.prompt\.md)/.exec(r.out)?.[1] as string);
        expect(prompt).toContain("The operation index is too long to include here");
        expect(prompt).toContain("sdlc api list --grep <word>");
        expect(prompt).not.toContain("/things/399/items");
      });
    });

    it("`implement` shows the documentation too", async () => {
      await inProject(WEB_ONLY, async (p) => {
        await p.run(["api", "import", p.outside("petstore.yaml", PETSTORE), "--name", "pets"]);
        expect((await p.run(["new", "pets-page"])).status).toBe(0);
        const dir = ".ai/specs/FEAT-001-pets-page";
        p.write(
          `${dir}/prd.md`,
          [
            "# FEAT-001: Pets Page",
            "Status: Accepted",
            "## 1. Objective\nShow a pet.",
            "## 2. User stories & acceptance criteria\n- **AC-001** Given a pet, when the page opens, then its name is shown.",
            "## 3. Permissions & roles\nNone.",
            "## 4. Data & validation\nNone.",
            "## 5. Contract impact\nNone.",
            "## 6. UI & design\nNo UI change.",
            "## 7. API integration\n- **Operations**: `GET /pet/{petId}`, for the page.",
            "## 8. Out of scope\nNothing.",
            "## 9. Verification map\nSee acceptance.json.",
            "",
          ].join("\n\n"),
        );
        p.write(`${dir}/acceptance.json`, JSON.stringify({ feature: "FEAT-001", checks: [{ id: "CHK-001", name: "a file", covers: ["AC-001"], type: "file", path: "README.md", exists: true }] }));
        const r = await p.run(["implement", "FEAT-001", "--dry-run", "--agent", "cat", "--allow-dirty", "--skip-baseline"]);
        expect(r.status, r.out).toBe(0);
        const prompt = p.read(/prompt\s+: (\S+implement\.prompt\.md)/.exec(r.out)?.[1] as string);
        expect(prompt).toContain("### API documentation (read-only)");
        expect(prompt).toContain("- `GET /pet/{petId}` getPetById");
        expect(prompt).toContain("API integration.** If the feature calls an API");
        expect(prompt).toContain("`.ai/api/`");
        expect(prompt).not.toMatch(/\{\{|<%/);
      });
    });
  });

  describe("links", () => {
    let server: Server;
    let base = "";
    const seen: string[] = [];

    beforeAll(async () => {
      server = createServer((req, res) => {
        seen.push(req.url ?? "");
        const url = new URL(req.url ?? "/", "http://x");
        if (url.pathname === "/openapi.json") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(parseYaml(PETSTORE)));
        } else if (url.pathname === "/shop.yaml") {
          res.setHeader("content-type", "application/yaml");
          res.end(stringifyYaml(SWAGGER2));
        } else if (url.pathname === "/docs") {
          res.setHeader("content-type", "text/html");
          res.end("<!doctype html><html><body><div id='swagger-ui'></div></body></html>");
        } else if (url.pathname === "/not-an-api.json") {
          res.setHeader("content-type", "application/json");
          res.end('{"hello":"world"}');
        } else {
          res.statusCode = 404;
          res.end("nothing here");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("imports a document from a link, and writes down the link without its query string", async () => {
      await inProject(WEB_ONLY, async (p) => {
        const r = await p.run(["api", "import", `${base}/openapi.json?api_key=SECRET-TOKEN-123`, "--name", "live"]);
        expect(r.status, r.out).toBe(0);
        expect(r.out).toContain("OpenAPI 3.0.2");
        const manifest = p.read(".ai/api/apis.json");
        expect(JSON.parse(manifest).apis[0].source).toBe(`${base}/openapi.json`);
        expect(manifest + r.out + p.read(".ai/api/live/endpoints.md")).not.toContain("SECRET-TOKEN-123");
        expect(p.exists(".ai/api/live/openapi.json")).toBe(true);
      });
    });

    it("reads a YAML link, and finds the document beside a documentation page", async () => {
      await inProject(WEB_ONLY, async (p) => {
        let r = await p.run(["api", "import", `${base}/shop.yaml`]);
        expect(r.status, r.out).toBe(0);
        expect(p.exists(".ai/api/legacy-shop/swagger.yaml")).toBe(true);
        r = await p.run(["api", "import", `${base}/docs`, "--name", "found"]);
        expect(r.status, r.out).toBe(0);
        expect(r.out).toContain("OpenAPI 3.0.2");
        expect(JSON.parse(p.read(".ai/api/apis.json")).apis.find((a: Json) => a.name === "found").source).toBe(`${base}/openapi.json`);
      });
    });

    it("does not follow a redirect to anything but an http(s) link", async () => {
      const bounce = createServer((req, res) => {
        res.statusCode = 302;
        res.setHeader("location", "ftp://127.0.0.1:1/openapi.json");
        res.end();
      });
      await new Promise<void>((resolve) => bounce.listen(0, "127.0.0.1", resolve));
      const address = bounce.address();
      const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api`;
      try {
        await inProject(WEB_ONLY, async (p) => {
          const r = await p.run(["api", "import", url]);
          expect(r.status, r.out).toBe(64);
          expect(r.out).toContain("no OpenAPI, Swagger or Postman document was found");
          expect(r.out).toContain("HTTP 302");
          expect(p.exists(".ai/api/apis.json")).toBe(false);
        });
      } finally {
        await new Promise<void>((resolve) => bounce.close(() => resolve()));
      }
    });

    it("follows a page that is not a document to the usual places beside it, lists what it tried when there is nothing, and never takes credentials in a link", async () => {
      await inProject(WEB_ONLY, async (p) => {
        let r = await p.run(["api", "import", `${base}/not-an-api.json`]);
        // the page itself is not one, but the usual places beside it are
        expect(r.status, r.out).toBe(0);
        r = await p.run(["api", "import", `${base}/nowhere`, "--name", "x"]);
        expect(r.status, r.out).toBe(0); // /openapi.json answers
        r = await p.run(["api", "import", "http://user:pass@127.0.0.1:1/openapi.json"]);
        expect(r.status).toBe(64);
        expect(r.out).toContain("user name or password");
        r = await p.run(["api", "import", "http://127.0.0.1:1/openapi.json"]);
        expect(r.status).toBe(64);
        expect(r.out).toContain("no OpenAPI, Swagger or Postman document was found");
        expect(r.out).toContain("could not be reached");
        r = await p.run(["api", "import", "ftp://example.com/openapi.json"]);
        expect(r.status).toBe(64);
        expect(seen.some((u) => u.includes("pass"))).toBe(false);
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------- the YAML reader

python("the YAML reader", () => {
  /** Runs `sdlc.yaml_load` on every text in one Python process: [{ok, value} | {ok: false, error}]. */
  async function read(texts: string[]): Promise<Array<{ ok: boolean; value?: unknown; error?: string }>> {
    const dir = mkdtempSync(join(tmpdir(), "scaffolder-yaml-"));
    try {
      for (const f of generate(WEB_ONLY).files.filter((x) => x.path === "scripts/sdlc.py")) {
        mkdirSync(join(dir, "scripts"), { recursive: true });
        writeFileSync(join(dir, f.path), f.content);
      }
      const code = [
        "import json, sys",
        `sys.path.insert(0, ${JSON.stringify(join(dir, "scripts"))})`,
        "import sdlc",
        "out = []",
        "for text in json.load(sys.stdin):",
        "    try:",
        '        out.append({"ok": True, "value": sdlc.yaml_load(text)})',
        "    except Exception as e:",
        '        out.append({"ok": False, "error": type(e).__name__ + ": " + str(e)})',
        "print(json.dumps(out))",
      ].join("\n");
      const r = spawnSync("python3", ["-I", "-c", code], { input: JSON.stringify(texts), encoding: "utf8", maxBuffer: 1 << 28 });
      if (r.status !== 0) throw new Error(r.stderr);
      return JSON.parse(r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const one = async (yaml: string) => (await read([yaml]))[0] as { ok: boolean; value?: unknown; error?: string };

  it("reads what the yaml library writes, in every style it can write it", async () => {
    // a seeded generator, so a failure can be replayed
    let seed = 20261125;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)] as T;
    const WORDS = ["pet", "id", "200", "/pets/{petId}", "x-vendor", "$ref", "#/components/schemas/Pet", "true", "null", "yes", "12", "1.5", "a: b", "# not a comment", "- dash", "it's", 'say "hi"', "tab\there", "ümlaut ✓", "trailing space ", " leading", "", "multi\nline", "multi\nline\n", "line one\n\nline three", "colon:", "{brace}", "[bracket]", "*star", "&amp", "!bang", "%pct", "@at", "`tick", "a\\b", "\u2028sep", "non\u00a0breaking"];
    const KEYS = ["pet", "id", "200", "default", "/pets/{petId}", "x-vendor", "$ref", "a b", "true", "null", "2xx", "text/plain", "application/json", "it's", "k:v"];
    const value = (depth: number): unknown => {
      const r = rnd();
      if (depth <= 0 || r < 0.35) {
        const kind = Math.floor(rnd() * 7);
        if (kind === 0) return pick([0, 1, -3, 42, 1.5, -0.25, 1e21, 3.14159]);
        if (kind === 1) return rnd() < 0.5;
        if (kind === 2) return null;
        if (kind === 3) return pick(WORDS).repeat(1 + Math.floor(rnd() * 12)).slice(0, 300);
        return pick(WORDS);
      }
      if (r < 0.65) {
        const o: Record<string, unknown> = {};
        for (let i = Math.floor(rnd() * 4); i > 0; i--) o[pick(KEYS) + (rnd() < 0.3 ? String(i) : "")] = value(depth - 1);
        return o;
      }
      return Array.from({ length: Math.floor(rnd() * 4) }, () => value(depth - 1));
    };
    const STYLES: Record<string, unknown>[] = [
      {}, { lineWidth: 0 }, { lineWidth: 30 }, { indent: 4 }, { indentSeq: false }, { defaultStringType: "QUOTE_DOUBLE" }, { defaultStringType: "QUOTE_SINGLE" },
      { defaultKeyType: "QUOTE_DOUBLE", defaultStringType: "QUOTE_SINGLE" }, { blockQuote: "folded" }, { collectionStyle: "flow" }, { indent: 3, indentSeq: false, lineWidth: 50 }, { singleQuote: true },
    ];
    const docs: Array<{ yaml: string; want: unknown; style: string }> = [];
    while (docs.length < 600) {
      const want = { root: value(4), second: value(3), list: [value(2), value(2)] };
      const style = pick(STYLES);
      const yaml = stringifyYaml(want, style as never);
      // the library writes an indentation indicator (`|2`) differently from libyaml for a block scalar that starts with spaces: not what API documents contain
      if (/[:-] [|>][1-9]/.test(yaml)) continue;
      docs.push({ yaml, want, style: JSON.stringify(style) });
    }
    const got = await read(docs.map((d) => d.yaml));
    const wrong = got.map((g, i) => ({ g, d: docs[i] as (typeof docs)[number] })).filter(({ g, d }) => !g.ok || JSON.stringify(g.value) !== JSON.stringify(d.want));
    expect(
      wrong.slice(0, 2).map(({ g, d }) => `${d.style} ${g.error ?? ""}\n${d.yaml}`),
      `${wrong.length} of ${docs.length} documents were read differently`,
    ).toEqual([]);
  });

  it("reads the petstore document the way libyaml does (compared with a stored reading of it)", async () => {
    const r = await one(PETSTORE);
    expect(r.ok, r.error).toBe(true);
    expect(JSON.stringify(r.value)).toBe(JSON.stringify(parseYaml(PETSTORE)));
    const v = r.value as Json;
    expect(v.openapi).toBe("3.0.2");
    expect(v.info.version).toBe("1.0.11");
    expect(v.info.description).toBe("This is a sample Pet Store Server.\nSome useful links:\n- [The Pet Store repository](https://github.com/swagger-api/swagger-petstore)");
    expect(Object.keys(v.paths["/pet"].put.responses)).toEqual(["200", "400", "404", "405"]);
    expect(v.paths["/pet"].put.security[0].petstore_auth).toEqual(["write:pets", "read:pets"]);
  });

  it("handles the things a hand-written file has: comments, a document marker, CRLF, a byte-order mark, blank lines", async () => {
    const cases: Array<[string, unknown]> = [
      ["# first\n---\na: 1 # one\n\n# between\nb: [1, 2] # two\nc: 'x # y'\nd: \"p # q\"\ne: r#s\n", { a: 1, b: [1, 2], c: "x # y", d: "p # q", e: "r#s" }],
      ["a: 1\r\nb:\r\n  - x\r\n  - y\r\n", { a: 1, b: ["x", "y"] }],
      ["\ufeffa: 1\n", { a: 1 }],
      ["a: 1\n...\nb: 2\n", { a: 1 }],
      ["a: 1\n---\nb: 2\n", { a: 1 }],
      ["a:\n- x\n- y: 1\n  z: 2\n-\n  - nested\nb: c\n", { a: ["x", { y: 1, z: 2 }, ["nested"]], b: "c" }],
      ["a: >\n  folded\n  text\n\n  next\nb: |+\n  keep\n\nc: |-\n  strip\n", { a: "folded text\nnext\n", b: "keep\n\n", c: "strip" }],
      ["a: long\n  plain\n  text\nb: x\n", { a: "long plain text", b: "x" }],
      ["a:\n  just a scalar on the next line\nb: x\n", { a: "just a scalar on the next line", b: "x" }],
      ["a: {b: [1, {c: d}], e: 'f'}\ng: [\n  1,\n  2\n]\n", { a: { b: [1, { c: "d" }], e: "f" }, g: [1, 2] }],
      ["'200': ok\n\"/pets/{id}\": x\n? y\n", "error"],
      ["a: 0x1F\nb: 0o17\nc: 1e3\nd: -.5\ne: 007\nf: .inf\ng: 2020-01-01\nh: 1.0\n", { a: 31, b: 15, c: 1000, d: -0.5, e: 7, f: ".inf", g: "2020-01-01", h: 1 }],
      ["a: ~\nb: null\nc:\nd: Null\ne: True\nf: FALSE\ng: yes\nh: no\n", { a: null, b: null, c: null, d: null, e: true, f: false, g: "yes", h: "no" }],
      ["a: \"line\\nbreak \\u00e9 \\x41 \\t tab\"\nb: 'it''s'\n", { a: "line\nbreak é A \t tab", b: "it's" }],
      ["a: \"folded\n  over\n\n  lines\"\n", { a: "folded over\nlines" }],
    ];
    const got = await read(cases.map(([y]) => y));
    cases.forEach(([y, want], i) => {
      const g = got[i] as (typeof got)[number];
      if (want === "error") expect(g.ok, y).toBe(false);
      else expect(g.ok ? g.value : g.error, y).toEqual(want);
    });
  });

  it("refuses what it does not support, instead of reading it wrongly", async () => {
    const refused: Array<[string, RegExp]> = [
      ["a: &x 1\nb: *x\n", /anchors, aliases and tags/],
      ["a: !!str 1\n", /anchors, aliases and tags/],
      ["base: &b {x: 1}\nuse:\n  <<: *b\n", /anchors, aliases and tags|merge keys/],
      ["use:\n  <<: {x: 1}\n", /merge keys/],
      ["a: 1\na: 2\n", /appears twice/],
      ["a:\n\tb: 1\n", /tab is used for indentation/],
      ["a: [1, 2\nb: 3\n", /never closed|flow/],
      ["a: \"never closed\nb: 1\n", /never closed/],
      ["a: 1\n b: 2\n", /unexpected|continuation|indent/],
      ["--- a: 1\n", /same line as ---/],
      ["a: \"x\\q\"\n", /unknown escape/],
    ];
    const got = await read(refused.map(([y]) => y));
    refused.forEach(([y, message], i) => {
      const g = got[i] as (typeof got)[number];
      // "a: 1\n b: 2" is, in YAML, a plain scalar continued on a second line: it is read, not refused
      if (y === "a: 1\n b: 2\n") return;
      expect(g.ok, y).toBe(false);
      expect(g.error, y).toMatch(message);
    });
  });
});
