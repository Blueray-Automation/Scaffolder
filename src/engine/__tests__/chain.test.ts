import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { defaultConfig, deepMerge } from "../config";
import { generateProject, type GeneratedFile } from "../generate";

type Json = Record<string, any>;

const HAVE_PYTHON = spawnSync("python3", ["--version"]).status === 0;
const python = HAVE_PYTHON ? describe : describe.skip;

const FULL = {}; // Next.js + FastAPI
const WEB_ONLY = { backend: { enabled: false }, database: { type: "none" } };
const FLUTTER_ONLY = { backend: { enabled: false }, web: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } };
const BACKEND_ONLY = { web: { enabled: false } };

const generate = (patch: Json) => generateProject(deepMerge(defaultConfig(), patch));
const text = (files: GeneratedFile[], path: string): string => {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`no generated file ${path}`);
  return f.content;
};

/** The block of a README between two headings. */
const section = (markdown: string, heading: string): string => {
  const start = markdown.indexOf(`## ${heading}`);
  expect(start, `no "${heading}" section`).toBeGreaterThan(-1);
  const rest = markdown.slice(start + 3);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
};

// ---------------------------------------------------------------------------------------------------- what is generated

describe("the chain, in the generated project's own words", () => {
  it("puts the chain in the README, in the order design, API, screens, with the same three moves everywhere", () => {
    for (const [name, patch] of [["full", FULL], ["backend only", BACKEND_ONLY], ["web only", WEB_ONLY], ["flutter only", FLUTTER_ONLY]] as const) {
      const chain = section(text(generate(patch).files, "README.md"), "Build something: the chain");
      expect(chain, name).toContain("./scripts/sdlc spec requirements.pdf --design mockups.pdf");
      expect(chain, name).toContain("./scripts/sdlc implement FEAT-001");
      expect(chain, name).toContain("./scripts/sdlc verify");
      expect(chain, name).toContain('Status: Accepted');
      expect(chain, name).toContain("design comes first");
      expect(chain, name).not.toMatch(/<%|%>|undefined/);
    }
  });

  it("a backend and a screen: one feature through every layer, or layer by layer with the backend first", () => {
    const chain = section(text(generate(FULL).files, "README.md"), "Build something: the chain");
    expect(chain).toContain("The simplest chain: one feature, every layer");
    expect(chain).toContain("Layer by layer");
    expect(chain.indexOf("# BACKEND")).toBeGreaterThan(-1);
    expect(chain.indexOf("# BACKEND")).toBeLessThan(chain.indexOf("# FRONTEND"));
    expect(chain).toContain('--focus "the API"');
    expect(chain).toContain('--focus "the screens"');
    expect(chain).toContain(".ai/contract/openapi.json");
    // the frontend of the same repository does not import the backend's contract: it already has it
    expect(chain).toContain("`backend`");
    // `--api` is for an API somebody else owns: the table says so, and no command of the chain uses it
    expect(chain).toContain("(an API you do not own: this project's own is its contract)");
    expect([...chain.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n")).not.toContain("--api");
    expect(chain).toContain("the API: which endpoints the screens need; the screens: what they look like in every state");
  });

  it("a backend on its own: the design first, then the API, then the contract goes to the frontend", () => {
    const readme = text(generate(BACKEND_ONLY).files, "README.md");
    const chain = section(readme, "Build something: the chain");
    expect(chain).toContain("The chain: the design first, then the API");
    expect(chain).toContain("spec requirements.pdf --design mockups.pdf");
    expect(chain).toContain("the API is built and its contract written");
    expect(chain).toContain("api import <this project's .ai/contract/openapi.json, or http://localhost:8000/openapi.json while it runs>");
    expect(chain).toContain("the API: which endpoints the screens need");
    expect(chain).not.toContain("the screens: what they look like");
    expect(chain).not.toContain("--api api.yaml");
  });

  it("a frontend on its own: the API's documentation and the design in, screens out", () => {
    for (const patch of [WEB_ONLY, FLUTTER_ONLY]) {
      const chain = section(text(generate(patch).files, "README.md"), "Build something: the chain");
      expect(chain).toContain("spec requirements.pdf --design mockups.pdf --api api.yaml");
      expect(chain).toContain("a typed client from the documentation, then the screens in every state");
      expect(chain).toContain("Import it once");
      expect(chain).toContain("API documentation (OpenAPI, Swagger, Postman, a link, a guide) | `--api api.yaml`");
    }
  });

  it("tells every agent the order, in AGENTS.md", () => {
    for (const patch of [FULL, BACKEND_ONLY, WEB_ONLY, FLUTTER_ONLY]) {
      const agents = text(generate(patch).files, "AGENTS.md");
      expect(agents).toContain("**design, then API, then screens**");
      expect(agents).toContain("sdlc spec requirements.pdf --design mockups.pdf");
    }
    expect(text(generate(WEB_ONLY).files, "AGENTS.md")).toContain("--design mockups.pdf --api api.yaml");
    expect(text(generate(BACKEND_ONLY).files, "AGENTS.md")).not.toContain("--api api.yaml");
  });

  it("the spec prompt shows the design to every project, and a backend is told to derive its API from it", () => {
    for (const patch of [FULL, BACKEND_ONLY, WEB_ONLY, FLUTTER_ONLY]) {
      const prompt = text(generate(patch).files, ".ai/prompts/spec.md");
      expect(prompt, JSON.stringify(patch)).toContain("## Design (read-only)\n\n{{designReferences}}");
    }
    const backend = text(generate(BACKEND_ONLY).files, ".ai/prompts/spec.md");
    expect(backend).toContain("**The API exists to serve these screens.**");
    expect(backend).toContain("make each one an endpoint");
    expect(backend).toContain("the picture is evidence of what is wanted, not a licence to invent rules");
    expect(backend).not.toContain("UI & design");
    expect(text(generate(WEB_ONLY).files, ".ai/prompts/spec.md")).toContain("These are the screens to build.");
    expect(text(generate(WEB_ONLY).files, ".ai/prompts/spec.md")).not.toContain("The API exists to serve these screens");
  });

  it("the implement prompt shows the design to a backend, and orders the layers when a feature has several", () => {
    const backend = text(generate(BACKEND_ONLY).files, ".ai/prompts/implement.md");
    expect(backend).toContain("### Design references (read-only)\n\n{{designReferences}}");
    expect(backend).toContain("The API exists to serve these screens");
    expect(backend).not.toContain("Build the screens to match the pictures");
    expect(backend).not.toContain("When the feature spans layers");
    const full = text(generate(FULL).files, ".ai/prompts/implement.md");
    expect(full).toContain("When the feature spans layers, build them in this order");
    expect(full.indexOf("**(1)** the API and its committed contract")).toBeLessThan(full.indexOf("**(3)** the screens in every state"));
    expect(full).toContain("Build the screens to match the pictures");
    const web = text(generate(WEB_ONLY).files, ".ai/prompts/implement.md");
    expect(web).not.toContain("When the feature spans layers");
    expect(web).not.toContain("The API exists to serve these screens");
  });

  it("the backend's rule, skill and PRD template say design first", () => {
    const files = generate(BACKEND_ONLY).files;
    expect(text(files, ".ai/rules/contract.md")).toContain("**Design first.**");
    expect(text(files, ".ai/skills/define-contract/SKILL.md")).toContain("design pictures in the spec's `design/` folder");
    expect(text(files, ".ai/specs/_template/prd.md")).toContain("name the screen each endpoint serves");
  });
});

// ---------------------------------------------------------------------------------------------------- the real Python

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
/** A real, decodable PNG of one colour. */
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [79, 70, 229]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

interface Project {
  dir: string;
  run: (args: string[]) => Promise<{ status: number | null; out: string }>;
  write: (path: string, data: string | Buffer) => void;
  read: (path: string) => string;
  exists: (path: string) => boolean;
  outside: (name: string, data: string | Buffer) => string;
}

async function inProject(patch: Json, body: (p: Project) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "scaffolder-chain-"));
  const away = mkdtempSync(join(tmpdir(), "scaffolder-chain-in-"));
  try {
    for (const f of generate(patch).files) {
      const target = join(dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    await body({
      dir,
      run: (args) =>
        new Promise((resolve) => {
          const child = spawn("python3", ["-I", join(dir, "scripts", "sdlc.py"), ...args], { cwd: dir, env: { ...process.env, FIGMA_TOKEN: "" } });
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

const promptOf = (p: Project, out: string, kind: "spec" | "implement"): string => p.read(new RegExp(`prompt\\s+: (\\S+${kind}\\.prompt\\.md)`).exec(out)?.[1] as string);

python("design as an input to every layer (the real Python)", () => {
  it("a backend on its own imports the design for a feature, and its spec and implement prompts show it", async () => {
    await inProject(BACKEND_ONLY, async (p) => {
      expect((await p.run(["new", "orders"])).status).toBe(0);
      const r = await p.run(["design", "import", p.outside("orders-list.png", png(8, 8)), "--feature", "FEAT-001"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("the API is drafted from these");
      expect(p.exists(".ai/specs/FEAT-001-orders/design/orders-list.png")).toBe(true);
      // the prompt a spec is drafted from lists the picture and says what to do with it
      p.write("requirements.md", "# Orders\nA customer sees their orders.\n");
      let dry = await p.run(["spec", "requirements.md", "--name", "orders", "--dry-run", "--agent", "cat", "--allow-dirty"]);
      expect(dry.status, dry.out).toBe(0);
      let prompt = promptOf(p, dry.out, "spec");
      expect(prompt).toContain("## Design (read-only)");
      expect(prompt).toContain("`.ai/specs/FEAT-001-orders/design/orders-list.png` (this feature): image, 8x8");
      expect(prompt).toContain("The API exists to serve these screens.");
      // and so does the prompt the code is written from
      p.write(
        ".ai/specs/FEAT-001-orders/prd.md",
        ["# FEAT-001: Orders", "Status: Accepted", "## 1. Objective\nList orders.", "## 2. User stories & acceptance criteria\n- **AC-001** Given orders, when a client asks, then it gets them.", "## 3. Permissions & roles\nNone.", "## 4. Data & validation\nNone.", "## 5. Contract impact\n`GET /api/v1/orders`.", "## 6. Out of scope\nNothing.", "## 7. Verification map\nSee acceptance.json.", ""].join("\n\n"),
      );
      p.write(".ai/specs/FEAT-001-orders/acceptance.json", JSON.stringify({ feature: "FEAT-001", checks: [{ id: "CHK-001", name: "a file", covers: ["AC-001"], type: "file", path: "README.md", exists: true }] }));
      dry = await p.run(["implement", "FEAT-001", "--dry-run", "--agent", "cat", "--allow-dirty", "--skip-baseline"]);
      expect(dry.status, dry.out).toBe(0);
      prompt = promptOf(p, dry.out, "implement");
      expect(prompt).toContain("### Design references (read-only)");
      expect(prompt).toContain("`.ai/specs/FEAT-001-orders/design/orders-list.png`");
      expect(prompt).toContain("check that every field they show and every action they offer is served by an endpoint");
      expect(prompt).not.toMatch(/\{\{|<%/);
    });
  });

  it("`spec --design` imports the pictures into the new feature before the agent starts, and the agent is shown them", async () => {
    await inProject(WEB_ONLY, async (p) => {
      const agent = p.outside(
        "agent.py",
        [
          "import json, pathlib, re, sys",
          "prompt = sys.stdin.read()",
          "found = re.search(r'`([^`]*specs/(FEAT-\\d+)-[^`/]+)/', prompt)",
          "spec_dir, feature = pathlib.Path(found.group(1)), found.group(2)",
          "for needle in ('Pictures of the design.', spec_dir.as_posix() + '/design/mockup.png', 'These are the screens to build.'):",
          "    if needle not in prompt:",
          "        print('the prompt is missing: ' + needle); sys.exit(3)",
          "if not (spec_dir / 'design' / 'mockup.png').is_file():",
          "    print('the picture was not imported before the agent started'); sys.exit(4)",
          "(spec_dir / 'prd.md').write_text('\\n\\n'.join(['# ' + feature + ': Orders Page', 'Status: Draft', '## 1. Objective\\nShow orders.',",
          "  '## 2. User stories & acceptance criteria\\n- **AC-001** Given the app, when it opens, then it shows a heading. (Source: page 1)',",
          "  '## 3. Permissions & roles\\nNone.', '## 4. Data & validation\\nNone.', '## 5. Contract impact\\nNone.',",
          "  '## 6. UI & design\\nSee design/mockup.png.', '## 7. API integration\\nNo API calls.', '## 8. Out of scope\\nNothing.', '## 9. Verification map\\nSee acceptance.json.', '']))",
          "(spec_dir / 'acceptance.json').write_text(json.dumps({'feature': feature, 'checks': [{'id': 'CHK-001', 'name': 'a file', 'covers': ['AC-001'], 'type': 'file', 'path': 'README.md', 'exists': True}]}))",
          "print('drafted ' + feature)",
          "",
        ].join("\n"),
      );
      p.write("requirements.md", "# Orders page\nThe page shows a heading.\n");
      const mockup = p.outside("mockup.png", png(16, 12));
      // a dry run creates nothing, and says what it would do
      const dry = await p.run(["spec", "requirements.md", "--name", "orders", "--design", mockup, "--dry-run", "--agent", "cat", "--allow-dirty"]);
      expect(dry.status, dry.out).toBe(0);
      expect(dry.out).toContain("the design in design/");
      expect(promptOf(p, dry.out, "spec")).toContain("None imported yet, but this run imports them first: mockup.png.");
      expect(p.exists(".ai/specs/FEAT-001-orders"), "a dry run creates nothing").toBe(false);

      const r = await p.run(["spec", "requirements.md", "--name", "orders", "--design", mockup, "--agent", `python3 ${agent}`, "--allow-dirty"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("== design ==");
      expect(r.out).toContain("imported mockup.png");
      expect(r.out).toContain("Draft ready");
      const dir = ".ai/specs/FEAT-001-orders";
      expect(p.exists(`${dir}/design/mockup.png`)).toBe(true);
      const manifest = JSON.parse(p.read(`${dir}/design/references.json`)) as Json;
      expect(manifest.references[0]).toMatchObject({ file: "mockup.png", kind: "image", width: 16, height: 12 });
      expect(JSON.stringify(manifest)).not.toContain(tmpdir());
      // what was imported is checked like any other reference, and the draft passes the spec check
      expect((await p.run(["design", "check"])).status).toBe(0);
      const facts = await p.run(["implement", "FEAT-001", "--dry-run", "--agent", "cat", "--allow-dirty", "--skip-baseline"]);
      expect(facts.status, facts.out).toBe(0);
      expect(facts.out).toContain("spec ok");
    });
  });

  it("`spec --design` refuses a file that is not a design before anything is created or the agent is started", async () => {
    await inProject(WEB_ONLY, async (p) => {
      p.write("requirements.md", "# Orders page\n");
      const r = await p.run(["spec", "requirements.md", "--name", "orders", "--design", "/no/such/mockup.png", "--agent", "cat", "--allow-dirty"]);
      expect(r.status).toBe(64);
      expect(r.out).toContain("is not a file (and not a Figma link)");
    });
  });

  it("a frontend repository imports the backend's committed contract, and its PRD may then name that backend's operations", async () => {
    let contract = "";
    await inProject(FULL, async (p) => {
      contract = p.read(".ai/contract/openapi.json");
    });
    expect(JSON.parse(contract).contract, "the snapshot is the committed contract, not an OpenAPI document").toBe(1);
    await inProject(WEB_ONLY, async (p) => {
      const r = await p.run(["api", "import", p.outside("openapi.json", contract), "--name", "orders-backend"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("OpenAPI 3.0.0");
      expect(r.out).toContain("3 operations");
      const list = await p.run(["api", "list"]);
      expect(list.out).toContain("`GET /api/v1/hello`");
      const show = await p.run(["api", "show", "GET", "/api/v1/hello"]);
      expect(show.out).toContain("name   query   string   optional");
      expect(show.out).toContain("HelloResponse {\n    message: string\n  }");
      expect((await p.run(["api", "check"])).status).toBe(0);
      const prd = p.read(".ai/specs/FEAT-000-hello-world/prd.md").replace(/## 7\. API integration[\s\S]*?(?=## 8\.)/, "## 7. API integration\n- **Operations**: `GET /api/v1/hello`, for the greeting.\n\n");
      p.write(".ai/specs/FEAT-000-hello-world/prd.md", prd);
      const facts = await p.run(["facts", "--runtime", "none"]);
      expect(facts.out).not.toContain("API integration section names");
      p.write(".ai/specs/FEAT-000-hello-world/prd.md", prd.replace("GET /api/v1/hello", "GET /api/v1/orders"));
      const wrong = await p.run(["facts", "--runtime", "none"]);
      const report = /\[(\.ai\/evidence\/[^\]]+\/report\.md)\]/.exec(wrong.out)?.[1] as string;
      expect(wrong.out + p.read(report)).toContain("names `GET /api/v1/orders`, which no imported API documents");
    });
  });
});
