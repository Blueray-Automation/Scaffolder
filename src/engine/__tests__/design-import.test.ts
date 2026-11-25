import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultConfig, deepMerge } from "../config";
import { generateProject } from "../generate";

type Json = Record<string, any>;

const HAVE_PYTHON = spawnSync("python3", ["--version"]).status === 0;
const python = HAVE_PYTHON ? describe : describe.skip;
const POSIX = process.platform !== "win32";
const TOKEN = "test-token-must-never-appear-anywhere";

// ---------------------------------------------------------------------------------------------------- image fixtures

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
function png(width: number, height: number, rgb: [number, number, number] = [79, 70, 229]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Only the header matters to the tool: these are not decodable pictures. */
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffc0001108002000300301220002110103110100ffd9".replace(/ /g, ""), "hex");
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([0x40, 0x01, 0xe0, 0x00]), Buffer.alloc(8)]);
function webpX(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0);
  b.writeUInt32LE(22, 4);
  b.write("WEBPVP8X", 8);
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

/** A small multi-page PDF (text only) that poppler renders. */
function pdf(pages: string[]): Buffer {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  pages.forEach((text, i) => {
    const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------------------------------------------------------------------------------------------------- project helpers

interface Project {
  dir: string;
  /** Runs the project's own `sdlc` (the real Python). */
  run: (args: string[], env?: Record<string, string>) => Promise<{ status: number | null; out: string }>;
  write: (path: string, data: string | Buffer) => void;
  read: (path: string) => string;
  /** A file outside the project, such as a design somebody was sent. */
  outside: (name: string, data: Buffer) => string;
}

async function inProject(patch: Json, body: (p: Project) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "scaffolder-import-"));
  const away = mkdtempSync(join(tmpdir(), "scaffolder-import-in-"));
  try {
    for (const f of generateProject(deepMerge(defaultConfig(), patch)).files) {
      const target = join(dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    const project: Project = {
      dir,
      run: (args, env = {}) =>
        new Promise((resolve) => {
          const child = spawn("python3", ["-I", join(dir, "scripts", "sdlc.py"), ...args], { cwd: dir, env: { ...process.env, FIGMA_TOKEN: "", ...env } });
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
      outside: (name, data) => {
        const full = join(away, name);
        writeFileSync(full, data);
        return full;
      },
    };
    expect((await project.run(["new", "login"])).status).toBe(0);
    await body(project);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  }
}

/** Evaluates a Python expression in the project's own sdlc.py (for the pure functions). */
function evalPy(dir: string, expr: string, env: Record<string, string> = {}): any {
  const code = `import importlib.util as u, json\ns = u.spec_from_file_location("sdlc", "scripts/sdlc.py")\nm = u.module_from_spec(s)\ns.loader.exec_module(m)\nprint(json.dumps(${expr}))`;
  const r = spawnSync("python3", ["-I", "-c", code], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${expr}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

const FEATURE = ".ai/specs/FEAT-001-login/design";

python("design import: images", () => {
  it("reads the size of a PNG, a JPEG, a GIF and a WebP from the header, and refuses anything else", async () => {
    await inProject({}, async (p) => {
      const bytes = (b: Buffer) => `bytes.fromhex("${b.toString("hex")}")`;
      expect(evalPy(p.dir, `m.image_info(${bytes(png(320, 200))})`)).toEqual(["png", 320, 200]);
      expect(evalPy(p.dir, `m.image_info(${bytes(JPEG)})`)).toEqual(["jpeg", 48, 32]);
      expect(evalPy(p.dir, `m.image_info(${bytes(GIF)})`)).toEqual(["gif", 320, 224]);
      expect(evalPy(p.dir, `m.image_info(${bytes(webpX(1440, 900))})`)).toEqual(["webp", 1440, 900]);
      expect(evalPy(p.dir, `m.image_info(b"just some text, not a picture at all")`)).toBeNull();
      expect(evalPy(p.dir, `m.image_info(${bytes(png(0, 5))})`)).toBeNull();
      expect(evalPy(p.dir, `m.image_info(b"")`)).toBeNull();
    });
  });

  it("copies an image into the feature's design folder with a record of what it is, and no local path", async () => {
    await inProject({}, async (p) => {
      const file = p.outside("Login Screen.PNG", png(320, 200));
      const r = await p.run(["design", "import", file, "--feature", "FEAT-001"]);
      expect(r.status, r.out).toBe(0);
      expect(readdirSync(join(p.dir, FEATURE)).sort()).toEqual(["login-screen.png", "references.json"]);
      const manifest = JSON.parse(p.read(`${FEATURE}/references.json`));
      expect(manifest.references).toHaveLength(1);
      expect(manifest.references[0]).toMatchObject({ file: "login-screen.png", kind: "image", source: "Login Screen.PNG", width: 320, height: 200 });
      expect(manifest.references[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.read(`${FEATURE}/references.json`)).not.toContain(tmpdir());
      expect(r.out).toContain("Next: write the PRD's UI & design section");
      expect((await p.run(["design", "check"])).status).toBe(0);
    });
  });

  it("takes several at once, in every format, and a second import of the same file changes nothing", async () => {
    await inProject({}, async (p) => {
      const files = [p.outside("a.png", png(10, 10)), p.outside("b.jpeg", JPEG), p.outside("c.gif", GIF), p.outside("d.webp", webpX(64, 48))];
      expect((await p.run(["design", "import", ...files, "--feature", "login"])).status).toBe(0);
      expect(readdirSync(join(p.dir, FEATURE)).sort()).toEqual(["a.png", "b.jpg", "c.gif", "d.webp", "references.json"]);
      const before = p.read(`${FEATURE}/references.json`);
      expect((await p.run(["design", "import", ...files, "--feature", "FEAT-001"])).status).toBe(0);
      expect(p.read(`${FEATURE}/references.json`)).toBe(before);
    });
  });

  it("chooses the file name with --name, and keeps a style guide apart from a feature", async () => {
    await inProject({}, async (p) => {
      const file = p.outside("whatever.png", png(8, 8));
      expect((await p.run(["design", "import", file, "--project", "--name", "brand-board"])).status).toBe(0);
      expect(existsSync(join(p.dir, ".ai/design/references/brand-board.png"))).toBe(true);
      expect(existsSync(join(p.dir, FEATURE))).toBe(false);
    });
  });

  it("says what is wrong instead of guessing", async () => {
    await inProject({}, async (p) => {
      const ok = p.outside("a.png", png(8, 8));
      const text = p.outside("fake.png", Buffer.from("this is a text file named like a picture"));
      const huge = p.outside("huge.png", Buffer.concat([png(8, 8), Buffer.alloc(16 * 1024 * 1024)]));
      const cases: Array<[string[], number, RegExp]> = [
        [["design", "import", ok], 64, /say where the references belong: --feature FEAT-001/],
        [["design", "import", ok, "--feature", "FEAT-099"], 64, /no feature 'FEAT-099'/],
        [["design", "import", ok, "--feature", "FEAT-001", "--project"], 64, /--feature or --project, not both/],
        [["design", "import", "--feature", "FEAT-001"], 64, /name what to import/],
        [["design", "import", text, "--feature", "FEAT-001"], 1, /not a PNG, JPEG, WebP or GIF/],
        [["design", "import", huge, "--feature", "FEAT-001"], 1, /the limit is 15 MB/],
        [["design", "import", join(p.dir, "missing.png"), "--feature", "FEAT-001"], 64, /is not a file/],
        [["design", "import", ok, "--feature", "FEAT-001", "--name", "Bad Name"], 64, /lowercase letters, digits and dashes/],
        [["design", "import", ok, p.outside("b.png", png(4, 4)), "--feature", "FEAT-001", "--name", "x"], 64, /names one import/],
        [["design", "import", "https://example.com/not-figma", "--feature", "FEAT-001"], 64, /not a Figma file link/],
      ];
      for (const [args, status, message] of cases) {
        const r = await p.run(args);
        expect(r.status, args.join(" ")).toBe(status);
        expect(r.out, args.join(" ")).toMatch(message);
      }
      expect(existsSync(join(p.dir, FEATURE))).toBe(false);
    });
  });

  it("still imports in a project with no screen: a backend reads the design to know what its API must serve", async () => {
    await inProject({ web: { enabled: false } }, async (p) => {
      const r = await p.run(["design", "import", p.outside("a.png", png(8, 8)), "--project"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("the API is drafted from these");
      expect(JSON.parse(p.read(".ai/design/references/references.json")).references[0].file).toBe("a.png");
      expect(existsSync(join(p.dir, ".ai/design/tokens.json")), "no tokens: there is no screen to style").toBe(false);
      const check = await p.run(["design", "check"]);
      expect(check.status).toBe(0);
      expect(check.out).toContain("no design tokens");
    });
  });

  it("is checked: an edited, replaced or deleted reference fails the design gate", async () => {
    await inProject({}, async (p) => {
      expect((await p.run(["design", "import", p.outside("a.png", png(8, 8)), p.outside("b.png", png(9, 9)), "--feature", "FEAT-001"])).status).toBe(0);
      expect((await p.run(["design", "check"])).status).toBe(0);
      writeFileSync(join(p.dir, FEATURE, "a.png"), png(8, 8, [1, 2, 3]));
      rmSync(join(p.dir, FEATURE, "b.png"));
      const r = await p.run(["design", "check"]);
      expect(r.status).toBe(1);
      expect(r.out).toContain(`${FEATURE}/a.png is not what references.json recorded`);
      expect(r.out).toContain(`${FEATURE}/b.png is listed in references.json but missing`);
      const manifest = JSON.parse(p.read(`${FEATURE}/references.json`));
      manifest.references.push({ file: "../../../etc/passwd", sha256: "x" });
      p.write(`${FEATURE}/references.json`, JSON.stringify(manifest));
      expect((await p.run(["design", "check"])).out).toContain("lists a file with an unusable name");
    });
  });

  it("shows the agent the pictures, the colours the design uses and where they are", async () => {
    await inProject({}, async (p) => {
      const spec = ".ai/specs/FEAT-001-login";
      expect(evalPy(p.dir, `m.design_references_text(m.ROOT / "${spec}")`)).toContain("None imported");
      expect((await p.run(["design", "import", p.outside("login.png", png(320, 200)), "--feature", "FEAT-001"])).status).toBe(0);
      const text: string = evalPy(p.dir, `m.design_references_text(m.ROOT / "${spec}")`);
      expect(text).toContain("`.ai/specs/FEAT-001-login/design/login.png` (this feature): image, 320x200");
      expect(text).toContain("Open every image and look at it");
      expect(p.read(".ai/prompts/implement.md")).toContain("{{designReferences}}");
    });
  });
});

python("design import: PDF", () => {
  const POPPLER = spawnSync("pdftoppm", ["-v"]).error === undefined;
  const real = POPPLER ? it : it.skip;

  real("renders the pages with poppler, keeps the text, and replaces them on a second import", async () => {
    await inProject({}, async (p) => {
      const file = p.outside("Mockups.pdf", pdf(["Welcome back", "Create account", "Settings"]));
      let r = await p.run(["design", "import", file, "--feature", "FEAT-001", "--pages", "2-3", "--dpi", "100"]);
      expect(r.status, r.out).toBe(0);
      expect(readdirSync(join(p.dir, FEATURE)).sort()).toEqual(["mockups-p2.png", "mockups-p3.png", "mockups.txt", "references.json"]);
      const manifest = JSON.parse(p.read(`${FEATURE}/references.json`)) as Json;
      const page = manifest.references.find((x: Json) => x.file === "mockups-p2.png");
      expect(page).toMatchObject({ kind: "pdf-page", source: "Mockups.pdf", page: 2, width: 850, height: 1100, dpi: 100 });
      expect(p.read(`${FEATURE}/mockups.txt`)).toContain("Welcome back");
      expect(r.out).toContain("page 2 of Mockups.pdf");
      expect((await p.run(["design", "check"])).status).toBe(0);

      r = await p.run(["design", "import", file, "--feature", "FEAT-001", "--pages", "1"]);
      expect(r.status, r.out).toBe(0);
      expect(readdirSync(join(p.dir, FEATURE)).sort()).toEqual(["mockups-p1.png", "mockups.txt", "references.json"]);
      expect((await p.run(["design", "check"])).status).toBe(0);
    });
  });

  real("refuses a page range that is too long, a bad range and a file that is not a PDF", async () => {
    await inProject({}, async (p) => {
      const file = p.outside("m.pdf", pdf(["One"]));
      expect((await p.run(["design", "import", file, "--feature", "FEAT-001", "--pages", "1-99"])).out).toContain("at most 20 pages at a time");
      expect((await p.run(["design", "import", file, "--feature", "FEAT-001", "--pages", "x"])).status).toBe(64);
      expect((await p.run(["design", "import", file, "--feature", "FEAT-001", "--dpi", "10"])).out).toContain("--dpi is between 72 and 300");
      const broken = p.outside("broken.pdf", Buffer.from("%PDF-1.4 this is not a pdf"));
      const r = await p.run(["design", "import", broken, "--feature", "FEAT-001"]);
      expect(r.status).toBe(1);
      expect(r.out).toContain("could not render broken.pdf");
    });
  });

  it("says how to install a renderer when there is none", async () => {
    await inProject({}, async (p) => {
      const bin = mkdtempSync(join(tmpdir(), "scaffolder-nobin-"));
      try {
        const py = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
        if (!POSIX) return;
        symlinkSync(py, join(bin, "python3"));
        const r = await p.run(["design", "import", p.outside("m.pdf", pdf(["One"])), "--feature", "FEAT-001"], { PATH: bin });
        expect(r.status).toBe(1);
        expect(r.out).toContain("no PDF renderer found");
        expect(r.out).toContain("brew install poppler");
        expect(r.out).toContain("sudo apt install poppler-utils");
        expect(r.out).toContain("export the pages as PNG images");
      } finally {
        rmSync(bin, { recursive: true, force: true });
      }
    });
  });

  (POSIX ? it : it.skip)("asks pdftoppm for exactly the pages and resolution wanted (a stand-in renderer)", async () => {
    await inProject({}, async (p) => {
      const bin = mkdtempSync(join(tmpdir(), "scaffolder-fakebin-"));
      try {
        const py = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
        symlinkSync(py, join(bin, "python3"));
        const calls = join(bin, "calls.txt");
        writeFileSync(
          join(bin, "pdftoppm"),
          `#!${py}\nimport sys\nopen(${JSON.stringify(calls)}, "a").write(" ".join(sys.argv[1:]) + "\\n")\n` +
            `first, last, prefix = int(sys.argv[sys.argv.index("-f") + 1]), int(sys.argv[sys.argv.index("-l") + 1]), sys.argv[-1]\n` +
            `png = bytes.fromhex(${JSON.stringify(png(30, 20).toString("hex"))})\n` +
            `for n in range(first, last + 1):\n    open("%s-%02d.png" % (prefix, n), "wb").write(png)\n`,
        );
        chmodSync(join(bin, "pdftoppm"), 0o755);
        const r = await p.run(["design", "import", p.outside("Deck.pdf", pdf(["x"])), "--feature", "FEAT-001", "--pages", "4-6", "--dpi", "200"], { PATH: bin });
        expect(r.status, r.out).toBe(0);
        const call = readFileSync(calls, "utf8");
        expect(call).toMatch(/^-png -r 200 -f 4 -l 6 .+Deck\.pdf .+page\n$/);
        expect(readdirSync(join(p.dir, FEATURE)).filter((n) => n.endsWith(".png")).sort()).toEqual(["deck-p4.png", "deck-p5.png", "deck-p6.png"]);
      } finally {
        rmSync(bin, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------- Figma

const FRAME_A: Json = {
  id: "1:2",
  name: "Login Screen",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
  cornerRadius: 12,
  layoutMode: "VERTICAL",
  itemSpacing: 16,
  paddingLeft: 24,
  paddingRight: 24,
  paddingTop: 24,
  paddingBottom: 24,
  children: [
    { id: "1:5", type: "TEXT", characters: "Sign in", absoluteBoundingBox: { x: 24, y: 300, width: 80, height: 24 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], style: { fontFamily: "Inter", fontWeight: 600, fontSize: 16 } },
    { id: "1:3", type: "TEXT", characters: "Welcome back", absoluteBoundingBox: { x: 24, y: 100, width: 300, height: 40 }, fills: [{ type: "SOLID", color: { r: 79 / 255, g: 70 / 255, b: 229 / 255, a: 1 } }], style: { fontFamily: "Inter", fontWeight: 600, fontSize: 32 } },
    { id: "1:4", type: "TEXT", characters: "Email\naddress", absoluteBoundingBox: { x: 24, y: 200, width: 80, height: 24 }, style: { fontFamily: "Inter", fontWeight: 400, fontSize: 16 } },
    { id: "1:6", type: "RECTANGLE", cornerRadius: 12, fills: [{ type: "SOLID", color: { r: 79 / 255, g: 70 / 255, b: 229 / 255, a: 1 } }, { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, visible: false }] },
    { id: "1:7", type: "TEXT", visible: false, characters: "Hidden", fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }], style: { fontSize: 99 } },
    { id: "1:8", type: "RECTANGLE", fills: [{ type: "SOLID", opacity: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } }] },
  ],
};
const FRAME_B: Json = { id: "1:9", name: "Sign Up", type: "FRAME", children: [{ id: "1:10", type: "TEXT", characters: "Create account", style: { fontSize: 24 } }] };
const FRAME_C: Json = { id: "1:11", name: "Empty", type: "FRAME", children: [] };
const FILE_NODES: Record<string, Json> = {
  "1:2": FRAME_A,
  "1:9": FRAME_B,
  "1:11": FRAME_C,
  "0:1": { id: "0:1", name: "Page 1", type: "CANVAS", children: [FRAME_A, FRAME_B, FRAME_C, { id: "0:2", type: "TEXT", name: "A note", characters: "not a frame" }] },
};
const VARIABLES = {
  status: 200,
  error: false,
  meta: {
    variableCollections: {
      "VariableCollectionId:1:1": { id: "VariableCollectionId:1:1", name: "Brand Colors", modes: [{ modeId: "1:0", name: "Light" }, { modeId: "1:1", name: "Dark" }], defaultModeId: "1:0" },
      "VariableCollectionId:2:1": { id: "VariableCollectionId:2:1", name: "Spacing", modes: [{ modeId: "2:0", name: "Mode 1" }], defaultModeId: "2:0" },
    },
    variables: {
      "VariableID:1:2": { id: "VariableID:1:2", name: "Primary/Default", variableCollectionId: "VariableCollectionId:1:1", resolvedType: "COLOR", valuesByMode: { "1:0": { r: 79 / 255, g: 70 / 255, b: 229 / 255, a: 1 }, "1:1": { r: 129 / 255, g: 140 / 255, b: 248 / 255, a: 1 } } },
      "VariableID:1:3": { id: "VariableID:1:3", name: "Accent", variableCollectionId: "VariableCollectionId:1:1", resolvedType: "COLOR", valuesByMode: { "1:0": { type: "VARIABLE_ALIAS", id: "VariableID:1:2" }, "1:1": { type: "VARIABLE_ALIAS", id: "VariableID:1:2" } } },
      "VariableID:2:2": { id: "VariableID:2:2", name: "Gap/Medium", variableCollectionId: "VariableCollectionId:2:1", resolvedType: "FLOAT", valuesByMode: { "2:0": 16 } },
      "VariableID:2:3": { id: "VariableID:2:3", name: "Label", variableCollectionId: "VariableCollectionId:2:1", resolvedType: "STRING", valuesByMode: { "2:0": "Inter" } },
    },
  },
};

interface Seen {
  url: string;
  token: string | undefined;
}

python("design import: Figma (against a stand-in server: the real Figma was not reachable from here)", () => {
  let server: Server;
  let base = "";
  let seen: Seen[] = [];
  /** What the next call to a path answers instead of the usual: [status, headers, body]. */
  let forced: Record<string, [number, Record<string, string>, string]> = {};
  let imageUrls: Record<string, string | null> | undefined;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const url = new URL(req.url ?? "/", base || "http://127.0.0.1");
      seen.push({ url: req.url ?? "", token: req.headers["x-figma-token"] as string | undefined });
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
        res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
      };
      for (const [prefix, [status, headers, body]] of Object.entries(forced)) {
        if (url.pathname.startsWith(prefix)) return send(status, body, headers);
      }
      const m = /^\/v1\/(files|images)\/KEY(\/nodes|\/variables\/local)?$/.exec(url.pathname);
      if (url.pathname.startsWith("/img/")) return send(200, png(200, 100));
      if (!m) return send(404, { status: 404, err: "Not found" });
      if (m[1] === "files" && m[2] === "/nodes") {
        const ids = (url.searchParams.get("ids") ?? "").split(",");
        return send(200, { name: "Shop app", lastModified: "2026-11-20T10:00:00Z", nodes: Object.fromEntries(ids.map((id) => [id, FILE_NODES[id] ? { document: FILE_NODES[id] } : null])) });
      }
      if (m[1] === "files" && m[2] === "/variables/local") return send(200, VARIABLES);
      if (m[1] === "files") return send(200, { name: "Shop app", document: { type: "DOCUMENT", children: [{ id: "0:1", name: "Page 1", type: "CANVAS", children: [{ id: "1:2", name: "Login Screen", type: "FRAME" }, { id: "1:9", name: "Sign Up", type: "FRAME" }] }] } });
      const ids = (url.searchParams.get("ids") ?? "").split(",");
      return send(200, { err: null, images: imageUrls ?? Object.fromEntries(ids.map((id) => [id, `${base}/img/${id.replace(":", "-")}.png`])) });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const link = (node = "1-2") => `https://www.figma.com/design/KEY/Shop-app${node ? `?node-id=${node}&t=abc` : ""}`;
  const env = () => ({ FIGMA_TOKEN: TOKEN, SDLC_FIGMA_API: base });
  const fresh = () => {
    seen = [];
    forced = {};
    imageUrls = undefined;
  };

  it("exports a frame as a picture with its text in reading order and a census of what it uses", async () => {
    fresh();
    await inProject({}, async (p) => {
      const r = await p.run(["design", "import", link(), "--feature", "FEAT-001"], env());
      expect(r.status, r.out).toBe(0);
      expect(readdirSync(join(p.dir, FEATURE)).sort()).toEqual(["login-screen-1-2.png", "login-screen-1-2.txt", "references.json"]);
      // the link's 1-2 is the API's 1:2; two requests to Figma, and the token went to Figma only
      const api = seen.filter((s) => s.url.startsWith("/v1/"));
      expect(api.map((s) => decodeURIComponent(s.url))).toEqual(["/v1/files/KEY/nodes?ids=1:2", "/v1/images/KEY?ids=1:2&format=png&scale=2"]);
      expect(api.every((s) => s.token === TOKEN)).toBe(true);
      expect(seen.filter((s) => s.url.startsWith("/img/")).every((s) => s.token === undefined)).toBe(true);
      expect(p.read(`${FEATURE}/login-screen-1-2.txt`)).toBe("Welcome back\nEmail address\nSign in\n");
      const manifest = JSON.parse(p.read(`${FEATURE}/references.json`)) as Json;
      const frame = manifest.references.find((x: Json) => x.kind === "figma-frame");
      expect(frame).toMatchObject({
        file: "login-screen-1-2.png",
        source: "https://www.figma.com/design/KEY?node-id=1-2",
        width: 200,
        height: 100,
        figma: { fileKey: "KEY", nodeId: "1:2", name: "Login Screen", fileName: "Shop app", lastModified: "2026-11-20T10:00:00Z", scale: 2 },
      });
      // colours by how often they are used; a hidden node and a hidden fill do not count; half-transparent keeps its alpha
      expect(frame.census.colors).toEqual([["#4f46e5", 2], ["#ffffff", 2], ["#00000080", 1]]);
      expect(frame.census.fontSizes).toEqual([[16, 2], [32, 1]]);
      expect(frame.census.fontWeights).toEqual([[600, 2], [400, 1]]);
      expect(frame.census.fontFamilies).toEqual([["Inter", 3]]);
      expect(frame.census.radii).toEqual([[12, 2]]);
      expect(frame.census.spacing).toEqual([[24, 4], [16, 1]]);
      // the token is nowhere on disk or on screen
      expect(r.out).not.toContain(TOKEN);
      for (const f of readdirSync(join(p.dir, FEATURE))) expect(readFileSync(join(p.dir, FEATURE, f)).includes(TOKEN)).toBe(false);
      expect(r.out).toContain("colours: #4f46e5 x2");
      expect((await p.run(["design", "check"])).status).toBe(0);
    });
  });

  it("exports the frames of a page, skips what Figma cannot render, and replaces them on a second import", async () => {
    fresh();
    await inProject({}, async (p) => {
      imageUrls = { "1:2": `${base}/img/a.png`, "1:9": `${base}/img/b.png`, "1:11": null };
      let r = await p.run(["design", "import", link("0-1"), "--feature", "FEAT-001"], env());
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("skipped 'Empty' (1:11)");
      expect(readdirSync(join(p.dir, FEATURE)).sort()).toEqual(["login-screen-1-2.png", "login-screen-1-2.txt", "references.json", "sign-up-1-9.png", "sign-up-1-9.txt"]);
      const before = p.read(`${FEATURE}/references.json`);
      r = await p.run(["design", "import", link("0-1"), "--feature", "FEAT-001"], env());
      expect(r.status).toBe(0);
      expect(p.read(`${FEATURE}/references.json`)).toBe(before);
    });
  });

  it("lists the frames to choose from when the link names none, and writes nothing", async () => {
    fresh();
    await inProject({}, async (p) => {
      const r = await p.run(["design", "import", link(""), "--feature", "FEAT-001"], env());
      expect(r.status).toBe(2);
      expect(r.out).toContain("This link names no frame");
      expect(r.out).toContain("Page 1 / Login Screen   --node 1:2");
      expect(existsSync(join(p.dir, FEATURE))).toBe(false);
      const again = await p.run(["design", "import", link(""), "--node", "1:9", "--feature", "FEAT-001", "--name", "signup"], env());
      expect(again.status, again.out).toBe(0);
      expect(existsSync(join(p.dir, FEATURE, "signup.png"))).toBe(true);
    });
  });

  it("needs the token in the environment, says how to get one, and does not call Figma without it", async () => {
    fresh();
    await inProject({}, async (p) => {
      const r = await p.run(["design", "import", link(), "--feature", "FEAT-001"], { SDLC_FIGMA_API: base });
      expect(r.status).toBe(64);
      expect(r.out).toContain("FIGMA_TOKEN environment variable (never in a file)");
      expect(r.out).toContain("file_content:read");
      expect(seen).toEqual([]);
    });
  });

  it("tells a refusal, a missing file and a rate limit apart, without ever printing the token", async () => {
    await inProject({}, async (p) => {
      const cases: Array<[[number, Record<string, string>, string], RegExp]> = [
        [[403, {}, JSON.stringify({ status: 403, err: "Forbidden" })], /Figma refused the token \(403\).*file_content:read/],
        [[404, {}, JSON.stringify({ status: 404, err: "Not found" })], /Figma has no such file \(404\)/],
        [[429, { "Retry-After": "42", "X-Figma-Plan-Tier": "pro", "X-Figma-Rate-Limit-Type": "low", "X-Figma-Upgrade-Link": "https://www.figma.com/pricing" }, "slow down"], /rate-limiting this token \(429\): try again in 42 seconds. Plan pro, seat limit low. Upgrade: https:\/\/www.figma.com\/pricing/],
        [[500, {}, "boom"], /Figma answered HTTP 500/],
      ];
      for (const [answer, message] of cases) {
        fresh();
        forced = { "/v1/files/KEY/nodes": answer };
        const r = await p.run(["design", "import", link(), "--feature", "FEAT-001"], env());
        expect(r.status, r.out).toBe(1);
        expect(r.out).toMatch(message);
        expect(r.out).not.toContain(TOKEN);
      }
      fresh();
      const none = await p.run(["design", "import", link("9-9"), "--feature", "FEAT-001"], env());
      expect(none.status).toBe(1);
      expect(none.out).toContain("Figma has no node 9:9");
      expect(existsSync(join(p.dir, FEATURE))).toBe(false);
    });
  });

  it("never fetches an image that is not served over https, and sends the token nowhere but Figma", async () => {
    fresh();
    await inProject({}, async (p) => {
      imageUrls = { "1:2": "http://images.example.invalid/frame.png" };
      const r = await p.run(["design", "import", link(), "--feature", "FEAT-001"], env());
      expect(r.status).toBe(1);
      expect(r.out).toContain("not https, so it was not fetched");
      // the API address can be replaced only by an address on this machine, never by one that would receive the token
      expect(evalPy(p.dir, `m.figma_api_base()`, { SDLC_FIGMA_API: "https://evil.example.com" })).toBe("https://api.figma.com");
      expect(evalPy(p.dir, `m.figma_api_base()`, { SDLC_FIGMA_API: "http://evil.example.com:80" })).toBe("https://api.figma.com");
      expect(evalPy(p.dir, `m.figma_api_base()`, { SDLC_FIGMA_API: "http://127.0.0.1:8123" })).toBe("http://127.0.0.1:8123");
      expect(evalPy(p.dir, `m.figma_api_base()`, { SDLC_FIGMA_API: "http://127.0.0.1:8123/x?y=1" })).toBe("https://api.figma.com");
    });
  });

  it("proposes tokens from the variables (Enterprise only), in a file nothing reads, and carries on without them", async () => {
    fresh();
    await inProject({}, async (p) => {
      const r = await p.run(["design", "import", link(), "--feature", "FEAT-001", "--variables"], env());
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("3 variable(s) proposed in .ai/design/tokens.proposed.json");
      const proposal = JSON.parse(p.read(".ai/design/tokens.proposed.json")) as Json;
      expect(proposal["brand-colors"].primary.default).toEqual({ $type: "color", $value: "#4f46e5", $extensions: { scaffolder: { dark: "#818cf8" } } });
      expect(proposal["brand-colors"].accent).toEqual({ $type: "color", $value: "#4f46e5", $extensions: { scaffolder: { dark: "#818cf8" } } });
      expect(proposal.spacing.gap.medium).toMatchObject({ $type: "dimension", $value: "16px" });
      expect(JSON.stringify(proposal)).not.toContain("Inter");
      expect(proposal.$description).toContain("PROPOSED");
      expect((await p.run(["design", "check"])).status, "the proposal is not the project's tokens").toBe(0);

      fresh();
      rmSync(join(p.dir, ".ai/design/tokens.proposed.json"));
      forced = { "/v1/files/KEY/variables/local": [403, {}, JSON.stringify({ status: 403, err: "Limited by Figma plan" })] };
      const limited = await p.run(["design", "import", link(), "--feature", "FEAT-001", "--variables"], env());
      expect(limited.status, limited.out).toBe(0);
      expect(limited.out).toContain("variables skipped");
      expect(limited.out).toContain("Enterprise plans");
      expect(existsSync(join(p.dir, ".ai/design/tokens.proposed.json"))).toBe(false);
    });
  });

  it("checks the options before it calls Figma", async () => {
    fresh();
    await inProject({}, async (p) => {
      expect((await p.run(["design", "import", link(), "--feature", "FEAT-001", "--scale", "9"], env())).out).toContain("--scale is between 0.5 and 4");
      expect((await p.run(["design", "import", link(), "--feature", "FEAT-001", "--node", "1;;'x y"], env())).status).toBe(64);
      expect(seen).toEqual([]);
    });
  });

  it("reads every kind of Figma link, and the node in both of its spellings", async () => {
    await inProject({}, async (p) => {
      const parse = (u: string) => evalPy(p.dir, `m.figma_parse(${JSON.stringify(u)})`);
      expect(parse("https://www.figma.com/design/AbC123/My-File?node-id=12-34")).toEqual(["AbC123", ["12:34"]]);
      expect(parse("https://www.figma.com/file/AbC123/My-File?node-id=12%3A34&t=x")).toEqual(["AbC123", ["12:34"]]);
      expect(parse("https://figma.com/design/AbC123?node-id=1-2")).toEqual(["AbC123", ["1:2"]]);
      expect(parse("https://www.figma.com/design/AbC123/branch/Br4nch/My-File?node-id=5-6")).toEqual(["Br4nch", ["5:6"]]);
      expect(parse("https://www.figma.com/proto/AbC123/My-File")).toEqual(["AbC123", []]);
      expect(parse("https://www.figma.com/board/AbC123/Board")).toEqual(["AbC123", []]);
    });
  });
});

describe("the documentation of the import", () => {
  it("is in the project guide, the skill and the wiki, with the same commands", () => {
    const files = generateProject(defaultConfig()).files;
    const text = (path: string) => files.find((f) => f.path === path)!.content;
    expect(text(".ai/design/README.md")).toContain("design import mockups.pdf --feature FEAT-001");
    expect(text(".ai/design/README.md")).toContain("FIGMA_TOKEN");
    expect(text(".ai/skills/implement-ui/SKILL.md")).toContain("design import");
    expect(text(".ai/prompts/implement.md")).toContain("### Design references (read-only)");
    expect(text("scripts/sdlc.py")).toContain('choices=["check", "sync", "import"]');
    expect(generateProject(deepMerge(defaultConfig(), { web: { enabled: false } })).files.find((f) => f.path === ".ai/prompts/implement.md")!.content).toContain("The API exists to serve these screens");
  });
});
