import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { defaultConfig, deepMerge, resolveConfig, validateConfig } from "../config";
import { designPlan, readTokens, renderCss, renderDart, scaled, tokensFile } from "../design";
import { generateProject, type GeneratedFile } from "../generate";

type Json = Record<string, any>;

const FULL = {}; // Next.js + FastAPI
const NUXT = { web: { framework: "nuxt" } };
const WEB_ONLY = { backend: { enabled: false }, database: { type: "none" } };
const FLUTTER_ONLY = { backend: { enabled: false }, web: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } };
const WEB_AND_MOBILE = { mobile: { enabled: true } };
const BACKEND_ONLY = { web: { enabled: false } };

const generate = (patch: Json) => generateProject(deepMerge(defaultConfig(), patch));
const text = (files: GeneratedFile[], path: string): string => {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`no generated file ${path}`);
  return f.content;
};

const HAVE_PYTHON = spawnSync("python3", ["--version"]).status === 0;

/** The project, written to a temporary folder, with a way to run its own `sdlc` (the real Python) and to change files. */
interface Project {
  dir: string;
  sdlc: (...args: string[]) => { status: number | null; out: string };
  write: (path: string, content: string) => void;
  read: (path: string) => string;
}

function inProject(patch: Json, run: (p: Project) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "scaffolder-design-"));
  try {
    for (const f of generate(patch).files) {
      const target = join(dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    run({
      dir,
      sdlc: (...args) => {
        const r = spawnSync("python3", ["-I", join(dir, "scripts", "sdlc.py"), ...args], { cwd: dir, encoding: "utf8", timeout: 60_000 });
        return { status: r.status, out: `${r.stdout}${r.stderr}` };
      },
      write: (path, content) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      },
      read: (path) => readFileSync(join(dir, path), "utf8"),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const python = HAVE_PYTHON ? describe : describe.skip;

describe("the default design tokens", () => {
  const { tokens, problems } = readTokens(JSON.parse(tokensFile()));

  it("are valid, and give the themes every colour they need, in both themes", () => {
    expect(problems).toEqual([]);
    const colours = tokens.filter((t) => t.type === "color");
    expect(colours.map((t) => t.path.join("."))).toEqual(
      ["accent", "bg", "border", "card", "danger", "fg", "muted"].map((n) => `color.${n}`),
    );
    for (const c of colours) expect(c.dark, c.path.join(".")).not.toBeNull();
  });

  it("are the look of the shipped hello page, as a stylesheet of CSS variables with the dark values in a media query", () => {
    const css = renderCss(tokens);
    expect(css.split("\n")[0]).toMatch(/^\/\* GENERATED from \.ai\/design\/tokens\.json by `\.\/scripts\/sdlc design sync`/);
    expect(css).toContain("  --color-bg: #fafafa;\n");
    expect(css).toContain("  --space-md: 1rem;\n");
    expect(css).toContain("  --font-family-base: system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;\n");
    expect(css).toContain("@media (prefers-color-scheme: dark) {\n  :root {\n    --color-accent: #818cf8;\n");
    expect(css.endsWith("}\n}\n")).toBe(true);
    expect(css).not.toMatch(/\r/);
  });

  it("become Dart constants: rem is 16 logical pixels, an em value and a font stack stay on the web", () => {
    const dart = renderDart(tokens);
    expect(dart).toContain("// dart format off\nimport 'dart:ui' show Color, FontWeight;");
    expect(dart).toContain("    accent: Color(0xFF4F46E5),");
    expect(dart).toContain("  static const double spaceMd = 16;");
    expect(dart).toContain("  static const double fontSizeSm = 12.8;");
    expect(dart).toContain("  static const double sizeContent = 512;");
    expect(dart).toContain("  static const FontWeight fontWeightSemibold = FontWeight.w600;");
    expect(dart).not.toMatch(/tracking|fontFamily|font-family/i);
    expect(dart.trimEnd().endsWith("// dart format on")).toBe(true);
  });

  it("scale decimals with whole-number arithmetic, so every language prints the same digits", () => {
    expect(scaled("0.25", 16)).toBe("4");
    expect(scaled("0.8", 16)).toBe("12.8");
    expect(scaled("1.0625", 16)).toBe("17");
    expect(scaled("0.7", 16)).toBe("11.2");
    expect(scaled("3.125", 16)).toBe("50");
    expect(scaled("16.0", 1)).toBe("16");
    expect(scaled("0", 16)).toBe("0");
    expect(scaled("-1.5", 16)).toBe("-24");
  });
});

describe("reading a tokens file", () => {
  const withEdit = (edit: (t: Json) => void) => {
    const tree = JSON.parse(tokensFile()) as Json;
    edit(tree);
    return readTokens(tree).problems;
  };

  it("names the token and what is wrong with it", () => {
    // a token with an unusable value is dropped, so it is also missing: both are reported
    expect(withEdit((t) => (t.color.accent.$value = "red"))).toEqual(["color.accent: a colour is written #rrggbb or #rrggbbaa", "color.accent: required (the themes use it)"]);
    expect(withEdit((t) => (t.color.accent.$extensions.scaffolder.dark = "#12"))).toEqual(["color.accent (dark): a colour is written #rrggbb or #rrggbbaa"]);
    expect(withEdit((t) => (t.space.md.$value = "16"))).toEqual(['space.md: a dimension is a number and a unit (px, rem or em), such as "1.5rem"']);
    expect(withEdit((t) => (t.font.weight.regular.$value = 450))).toEqual(["font.weight.regular: a font weight is 100, 200, ... 900"]);
    expect(withEdit((t) => (t.font.family.base.$value = "a; b"))).toEqual(["font.family.base: a font family is a non-empty font stack on one line"]);
    expect(withEdit((t) => (t.space.md.$extensions = { scaffolder: { dark: "#000000" } }))).toEqual(["space.md: only a colour has a dark value"]);
  });

  it("requires the colours the themes use", () => {
    expect(withEdit((t) => delete t.color.danger)).toEqual(["color.danger: required (the themes use it)"]);
  });

  it("refuses a token without a type, a name with capitals, and a token that holds tokens", () => {
    expect(withEdit((t) => (t.extra = { ok: { $value: "#000000" } }))).toEqual(["extra.ok: needs a $type of color, dimension, fontFamily, fontWeight"]);
    expect(withEdit((t) => (t.color.Brand = { $value: "#000000" }))).toEqual(["color.Brand: names use lowercase letters, digits and dashes"]);
    expect(withEdit((t) => (t.color.bg.inner = { $value: "#000000" }))).toEqual(["color.bg: a token cannot also hold other tokens", "color.bg: required (the themes use it)"]);
    expect(readTokens([]).problems).toEqual(["the file must hold one JSON object"]);
  });

  it("refuses two tokens that would be the same CSS variable, and a colour Dart cannot name", () => {
    expect(withEdit((t) => (t["color-bg"] = { $type: "dimension", $value: "1px" }))).toEqual(["color-bg: becomes --color-bg, which color.bg already is"]);
    expect(withEdit((t) => (t.color.default = { $value: "#000000" }))).toEqual(["color.default: default is a Dart reserved word"]);
  });

  it("accepts a type given on the group or on the token, a numeric weight given as a string, and an alpha colour", () => {
    const tree = JSON.parse(tokensFile()) as Json;
    tree.font.weight.bold = { $value: "700" };
    tree.color.scrim = { $type: "color", $value: "#00000080" };
    const { tokens, problems } = readTokens(tree);
    expect(problems).toEqual([]);
    expect(renderDart(tokens)).toContain("static const FontWeight fontWeightBold = FontWeight.w700;");
    expect(renderDart(tokens)).toContain("scrim: Color(0x80000000),");
  });

  it("gives the same order whatever order the file has", () => {
    const a = JSON.parse(tokensFile()) as Json;
    const b = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse()))) as Json;
    expect(renderCss(readTokens(b).tokens)).toBe(renderCss(readTokens(a).tokens));
  });
});

describe("the project's configuration", () => {
  it("has design enforced by default, and ignores it for a project with no screen", () => {
    expect(defaultConfig().design).toEqual({ enforce: true, tool: "none", url: "" });
    expect(resolveConfig(deepMerge(defaultConfig(), BACKEND_ONLY)).design.enforce).toBe(false);
    expect(resolveConfig(deepMerge(defaultConfig(), FLUTTER_ONLY)).design.enforce).toBe(true);
  });

  it("rejects an unknown design tool and a link that is not http(s)", () => {
    const bad = (design: Json) => validateConfig(resolveConfig({ design })).filter((i) => i.level === "error").map((i) => i.path);
    expect(bad({ tool: "sketchpad" })).toEqual(["design.tool"]);
    expect(bad({ url: "figma.com/file/abc" })).toEqual(["design.url"]);
    expect(bad({ url: "javascript:alert(1)" })).toEqual(["design.url"]);
    expect(bad({ tool: "figma", url: "https://www.figma.com/design/abc/My-App" })).toEqual([]);
  });

  it("puts the tokens where each stack looks for them", () => {
    const plan = (patch: Json) => designPlan(resolveConfig(deepMerge(defaultConfig(), patch)));
    expect(plan(FULL)?.outputs).toEqual([{ target: "css", path: "web/src/app/tokens.css" }]);
    expect(plan(NUXT)?.outputs).toEqual([{ target: "css", path: "web/app/assets/css/tokens.css" }]);
    expect(plan(FLUTTER_ONLY)?.outputs).toEqual([{ target: "dart", path: "mobile/lib/theme/tokens.dart" }]);
    expect(plan({ ...WEB_AND_MOBILE, layout: { webDir: "apps/web", mobileDir: "apps/app" } })?.outputs).toEqual([
      { target: "css", path: "apps/web/src/app/tokens.css" },
      { target: "dart", path: "apps/app/lib/theme/tokens.dart" },
    ]);
    expect(plan(BACKEND_ONLY)).toBeNull();
  });
});

describe("what a generated project gets", () => {
  it("a project with a screen has the tokens, the stylesheet or Dart file built from them, and the rule, skill and guide", () => {
    for (const patch of [FULL, NUXT, WEB_ONLY, FLUTTER_ONLY, WEB_AND_MOBILE]) {
      const { files } = generate(patch);
      const paths = files.map((f) => f.path);
      for (const p of [".ai/design/tokens.json", ".ai/design/README.md", ".ai/rules/design.md", ".ai/skills/implement-ui/SKILL.md"]) {
        expect(paths, JSON.stringify(patch)).toContain(p);
      }
      expect(JSON.parse(text(files, ".ai/design/tokens.json")).color.accent.$value).toBe("#4f46e5");
    }
  });

  it("a backend on its own has none of it: no tokens, no gate, no UI section in its PRDs", () => {
    const { files } = generate(BACKEND_ONLY);
    expect(files.map((f) => f.path).filter((p) => /design|implement-ui|tokens/.test(p))).toEqual([]);
    const sdlc = JSON.parse(text(files, ".ai/sdlc.json")) as Json;
    expect(sdlc.design).toBeUndefined();
    expect(sdlc.gates.map((g: Json) => g.id)).not.toContain("repo.design");
    expect(text(files, ".ai/specs/_template/prd.md")).not.toMatch(/UI & design/);
    expect(text(files, ".ai/specs/FEAT-000-hello-world/prd.md")).not.toMatch(/UI & design/);
    expect(text(files, "AGENTS.md")).not.toMatch(/design/i);
  });

  it("the gate is one more repository check: in the loop and, with the same command, in CI", () => {
    const { files } = generate(FULL);
    const sdlc = JSON.parse(text(files, ".ai/sdlc.json")) as Json;
    const gate = sdlc.gates.find((g: Json) => g.id === "repo.design");
    expect(gate).toMatchObject({ stage: "static", component: "repo", cwd: ".", cmd: "python3 scripts/sdlc.py design check", required: true });
    const ci = parse(text(files, ".github/workflows/ci.yml")) as Json;
    expect((ci.jobs.repo.steps as Json[]).map((s) => s.run)).toContain(gate.cmd);
    expect(sdlc.design).toMatchObject({
      enforce: true,
      tokens: ".ai/design/tokens.json",
      outputs: [{ target: "css", path: "web/src/app/tokens.css" }],
      scan: [{ root: "web/src", kind: "web" }],
    });
    // The agent may not edit the tokens quietly: a change is allowed but listed in the report.
    expect(sdlc.integrity.guarded).toContain(".ai/design/");
    expect(sdlc.integrity.protectedWhileHealing).toContain(".ai/specs/");
  });

  it("with the gate turned off the tokens still style the screens, and the PRD needs no UI section", () => {
    const { files, config } = generate({ design: { enforce: false }, api: { enforce: false } });
    expect(config.design.enforce).toBe(false);
    const sdlc = JSON.parse(text(files, ".ai/sdlc.json")) as Json;
    expect(sdlc.gates.map((g: Json) => g.id)).not.toContain("repo.design");
    expect(sdlc.design.enforce).toBe(false);
    expect(files.map((f) => f.path)).toContain("web/src/app/tokens.css");
    expect(text(files, ".ai/specs/_template/prd.md")).not.toMatch(/UI & design/);
    expect(text(files, ".ai/specs/_template/prd.md")).toContain("## 6. Out of scope");
    expect(text(files, ".ai/rules/design.md")).toContain("Not enforced in this project");
  });

  it("turning off linting turns the design gate off with it, like any other static check", () => {
    const { files } = generate({ sdlc: { gates: { lint: false } } });
    expect((JSON.parse(text(files, ".ai/sdlc.json")) as Json).gates.map((g: Json) => g.id)).not.toContain("repo.design");
  });

  it("the PRD template and the worked example have a UI & design section, and the sections after it are renumbered", () => {
    for (const patch of [FULL, WEB_ONLY, FLUTTER_ONLY]) {
      const { files } = generate(patch);
      const template = text(files, ".ai/specs/_template/prd.md");
      expect(template).toMatch(/^## 6\. UI & design$/m);
      expect(template).toMatch(/^## 7\. API integration$/m); // the API section follows the design one (api.test.ts covers the numbering in full)
      expect(template).toMatch(/^## 8\. Out of scope$/m);
      expect(template).toMatch(/^## 9\. Verification map$/m);
      const example = text(files, ".ai/specs/FEAT-000-hello-world/prd.md");
      expect(example).toMatch(/^## 6\. UI & design$/m);
      expect(example).toMatch(/^## 9\. Verification map$/m);
      expect(example).not.toMatch(/TODO\(prd\)/);
      expect(text(files, ".ai/rules/prd.md")).toContain("6. **UI & design**");
    }
  });

  it("the design file link and tool reach the PRD template and the guide", () => {
    const { files } = generate({ design: { tool: "figma", url: "https://www.figma.com/design/abc/My-App" } });
    expect(text(files, ".ai/specs/_template/prd.md")).toContain("`https://www.figma.com/design/abc/My-App`");
    expect(text(files, ".ai/design/README.md")).toContain("Figma");
    expect(text(files, ".ai/design/README.md")).toContain("https://www.figma.com/design/abc/My-App");
    expect(text(generate({}).files, ".ai/design/README.md")).toContain("No design file is linked yet");
  });

  it("every stack's shipped styles use tokens only, and tell the agent so", () => {
    for (const [patch, css] of [
      [FULL, "web/src/app/globals.css"],
      [NUXT, "web/app/assets/css/main.css"],
    ] as const) {
      const { files } = generate(patch);
      // (a one-pixel border is a line, not a measurement of the design)
      expect(text(files, css).replace(/1px solid/g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|\b\d+(\.\d+)?(px|rem)\b/i);
      expect(text(files, css)).toContain("var(--color-bg)");
    }
    expect(text(generate(FULL).files, "web/src/app/layout.tsx")).toMatch(/import "\.\/tokens\.css";\nimport "\.\/globals\.css";/);
    expect(text(generate(NUXT).files, "web/nuxt.config.ts")).toContain('css: ["~/assets/css/tokens.css", "~/assets/css/main.css"]');
    expect(text(generate(FULL).files, ".ai/rules/web-nextjs.md")).toContain("design token");
    expect(text(generate(NUXT).files, ".ai/rules/web-nuxt.md")).toContain("design token");
    expect(text(generate(FLUTTER_ONLY).files, ".ai/rules/mobile-flutter.md")).toContain("Tokens.spaceMd");
    expect(text(generate(FLUTTER_ONLY).files, "mobile/lib/app.dart")).toContain("buildTheme(Brightness.dark)");
  });

  it("the web-only and the mobile-only guides do not talk about the other platform", () => {
    const web = generate(WEB_ONLY).files.filter((f) => /^\.ai\/(design|rules\/design|skills\/implement-ui)/.test(f.path));
    for (const f of web) expect(f.content, f.path).not.toMatch(/Dart|Flutter|flutter|mobile/);
    const mobile = generate(FLUTTER_ONLY).files.filter((f) => /^\.ai\/(design|rules\/design|skills\/implement-ui)/.test(f.path));
    for (const f of mobile) expect(f.content, f.path).not.toMatch(/CSS|Next\.js|Nuxt|role="alert"|var\(--/);
  });
});

python("the generated project's own `sdlc design`", () => {
  const stacks: Array<[string, Json]> = [
    ["Next.js with a backend", FULL],
    ["Next.js on its own", WEB_ONLY],
    ["Nuxt", NUXT],
    ["Flutter on its own", FLUTTER_ONLY],
    ["Next.js and Flutter", WEB_AND_MOBILE],
  ];

  it.each(stacks)("finds a new project (%s) in sync, with nothing hard-coded", (_name, patch) => {
    inProject(patch, (p) => {
      const r = p.sdlc("design", "check");
      expect(r.out).toMatch(/design: 23 tokens valid, \d+ generated file\(s\) in sync, \d+ source file\(s\) use only tokens/);
      expect(r.status).toBe(0);
    });
  });

  it("writes the same bytes as the scaffolder's own generator, for tokens that use every feature", () => {
    const tokens = {
      color: {
        $type: "color",
        bg: { $value: "#FAFAFA", $extensions: { scaffolder: { dark: "#09090B" } } },
        fg: { $value: "#18181B", $extensions: { scaffolder: { dark: "#FAFAFA" } } },
        muted: { $value: "#71717A" },
        card: { $value: "#ffffff", $extensions: { scaffolder: { dark: "#ffffff" } } },
        border: { $value: "#E4E4E7", $extensions: { scaffolder: { dark: "#27272a" } } },
        accent: { $value: "#4F46E5CC", $extensions: { scaffolder: { dark: "#818CF8" } } },
        danger: { $value: "#b91c1c" },
        "on-accent": { $value: "#ffffff" },
        scrim: { $value: "#00000080" },
      },
      space: {
        $type: "dimension",
        xs: { $value: "4px" },
        "2xl": { $value: "3.125rem" },
        sm: { $value: "0.5rem" },
        tight: { $value: "0.1em" },
        neg: { $value: "-0.25rem" },
        zero: { $value: "0rem" },
      },
      radius: { $type: "dimension", pill: { $value: "9999px" }, lg: { $value: "0.75rem" } },
      font: {
        family: { $type: "fontFamily", base: { $value: ' Inter, "Segoe UI", system-ui, sans-serif ' } },
        weight: { $type: "fontWeight", bold: { $value: "700" }, light: { $value: 300 }, thin: { $value: 100.0 } },
        size: { $type: "dimension", body: { $value: "1.0625rem" }, caption: { $value: "0.7rem" }, big: { $value: "2.5rem" } },
      },
      size: { $type: "dimension", icon: { $value: "24px" } },
    };
    inProject(WEB_AND_MOBILE, (p) => {
      p.write(".ai/design/tokens.json", JSON.stringify(tokens, null, 2));
      expect(p.sdlc("design", "check").status, "stale outputs must be reported").toBe(1);
      const sync = p.sdlc("design", "sync");
      expect(sync.status, sync.out).toBe(0);
      const { tokens: read, problems } = readTokens(tokens);
      expect(problems).toEqual([]);
      expect(p.read("web/src/app/tokens.css")).toBe(renderCss(read));
      expect(p.read("mobile/lib/theme/tokens.dart")).toBe(renderDart(read));
      expect(p.sdlc("design", "sync").out).toContain("already in sync");
      // the shipped styles use tokens these custom tokens no longer define: that is reported, not left to a blank page
      const check = p.sdlc("design", "check");
      expect(check.status).toBe(1);
      expect(check.out).toContain("var(--space-lg) is not defined by any token");
      expect(check.out).not.toContain("is not what");
    });
  });

  it("refuses an invalid tokens file with the token named, and writes nothing", () => {
    inProject(FULL, (p) => {
      const tree = JSON.parse(p.read(".ai/design/tokens.json")) as Json;
      tree.color.accent.$value = "indigo";
      delete tree.color.danger;
      p.write(".ai/design/tokens.json", JSON.stringify(tree));
      const before = p.read("web/src/app/tokens.css");
      for (const action of ["check", "sync"]) {
        const r = p.sdlc("design", action);
        expect(r.status).toBe(1);
        expect(r.out).toContain("color.accent: a colour is written #rrggbb or #rrggbbaa");
        expect(r.out).toContain("color.danger: required");
      }
      expect(p.read("web/src/app/tokens.css")).toBe(before);
      p.write(".ai/design/tokens.json", "{ not json");
      expect(p.sdlc("design", "check").out).toContain("is not valid JSON");
    });
  });

  it("notices a generated file someone edited, and a token someone changed without syncing, and `sync` repairs both", () => {
    inProject(FULL, (p) => {
      p.write("web/src/app/tokens.css", p.read("web/src/app/tokens.css").replace("#4f46e5", "#ff0000"));
      let r = p.sdlc("design", "check");
      expect(r.status).toBe(1);
      expect(r.out).toContain("web/src/app/tokens.css is not what .ai/design/tokens.json produces: run ./scripts/sdlc design sync");
      expect(p.sdlc("design", "sync").status).toBe(0);
      expect(p.sdlc("design", "check").status).toBe(0);

      p.write(".ai/design/tokens.json", p.read(".ai/design/tokens.json").replace("#4f46e5", "#0ea5e9"));
      r = p.sdlc("design", "check");
      expect(r.status).toBe(1);
      expect(r.out).toContain("run ./scripts/sdlc design sync");
      p.sdlc("design", "sync");
      expect(p.read("web/src/app/tokens.css")).toContain("--color-accent: #0ea5e9;");
      expect(p.sdlc("design", "check").status).toBe(0);

      p.write("web/src/app/tokens.css", "");
      expect(p.sdlc("design", "check").status).toBe(1);
      rmSync(join(p.dir, "web/src/app/tokens.css"));
      expect(p.sdlc("design", "check").out).toContain("tokens.css is missing");
    });
  });

  it("is quiet for a project that has no screen", () => {
    inProject(BACKEND_ONLY, (p) => {
      const r = p.sdlc("design", "check");
      expect(r.status).toBe(0);
      expect(r.out).toContain("no design tokens");
    });
  });

  describe("fails a web screen that hard-codes a design value, naming the file and line", () => {
    const hardCoded: Array<[string, string, string, RegExp]> = [
      ["a hex colour in a component", "web/src/components/Banner.tsx", 'export const style = { background: "#ff00aa" };\n', /Banner\.tsx:1: the colour #ff00aa is hard-coded/],
      ["a short and an alpha hex colour", "web/src/components/Banner.tsx", 'const a = "#fff";\nconst b = "#ff00aa80";\n', /Banner\.tsx:1: the colour #fff[\s\S]*Banner\.tsx:2: the colour #ff00aa80/],
      ["rgb() in a stylesheet", "web/src/app/extra.css", ".x {\n  background: rgb(10, 20, 30);\n}\n", /extra\.css:2: a colour function \(rgb\(\)/],
      ["hsla() in a component", "web/src/components/Banner.tsx", 'const c = "hsla(10 20% 30% / 0.5)";\n', /Banner\.tsx:1: a colour function \(hsla\(\)/],
      ["a colour name in a stylesheet", "web/src/app/extra.css", ".x {\n  color: red;\n}\n", /extra\.css:2: the colour name red is hard-coded/],
      ["a pixel padding", "web/src/app/extra.css", ".x {\n  padding: 12px;\n}\n", /extra\.css:2: a length is hard-coded in `padding: 12px`/],
      ["a rem gap among tokens", "web/src/app/extra.css", ".x {\n  gap: var(--space-sm) 1.5rem;\n}\n", /extra\.css:2: a length is hard-coded/],
      ["a fallback length inside var()", "web/src/app/extra.css", ".x {\n  margin: var(--space-md, 16px);\n}\n", /extra\.css:2: a length is hard-coded/],
      ["a radius", "web/src/app/extra.css", ".x {\n  border-radius: 6px;\n}\n", /border-radius: 6px/],
      ["a corner radius", "web/src/app/extra.css", ".x {\n  border-top-left-radius: 6px;\n}\n", /border-top-left-radius: 6px/],
      ["a font size", "web/src/app/extra.css", ".x {\n  font-size: 14px;\n}\n", /font-size: 14px/],
      ["a side padding", "web/src/app/extra.css", ".x {\n  padding-inline-start: 0.5rem;\n}\n", /padding-inline-start: 0\.5rem/],
      ["an inline style in a component", "web/src/components/Banner.tsx", 'export const s = { padding: "12px", fontSize: "1.1rem" };\n', /Banner\.tsx:1: a length is hard-coded in `padding: "12px/],
      ["a variable no token defines", "web/src/app/extra.css", ".x {\n  color: var(--color-brand);\n}\n", /extra\.css:2: var\(--color-brand\) is not defined by any token/],
    ];

    it.each(hardCoded)("%s", (_name, path, content, expected) => {
      inProject(FULL, (p) => {
        p.write(path, content);
        const r = p.sdlc("design", "check");
        expect(r.status, r.out).toBe(1);
        expect(r.out).toMatch(expected);
        expect(r.out).toContain("rule: .ai/rules/design.md");
      });
    });

    const fine: Array<[string, string, string]> = [
      ["tokens everywhere", "web/src/app/extra.css", ".x {\n  padding: var(--space-md) var(--space-lg);\n  color: var(--color-accent);\n  border-radius: var(--radius-sm);\n  font-size: var(--font-size-base);\n}\n"],
      ["zero lengths and a keyword colour", "web/src/app/extra.css", ".x {\n  margin: 0;\n  padding: 0px 0rem;\n  color: inherit;\n  background-color: transparent;\n  fill: currentColor;\n}\n"],
      ["layout sizes that are not spacing, radius or type", "web/src/app/extra.css", ".x {\n  width: 320px;\n  min-height: 100vh;\n  border: 1px solid var(--color-border);\n  transition: opacity 200ms;\n}\n"],
      ["a calculation made of tokens", "web/src/app/extra.css", ".x {\n  margin: calc(var(--space-md) * 2);\n  width: min(var(--size-content), 100%);\n}\n"],
      ["a variable the stylesheet defines itself", "web/src/app/extra.css", ".x {\n  --gap-local: var(--space-sm);\n  gap: var(--gap-local);\n}\n"],
      ["a hex-like word that is not a colour", "web/src/components/Banner.tsx", 'const id = "item#abcdefg";\nconst a = "x &#123; y";\nconst href = "https://example.com/page#abc";\n'],
      ["a colour in a block comment", "web/src/app/extra.css", "/* was #fafafa */\n.x {\n  color: var(--color-fg);\n}\n"],
      ["a value marked as deliberate", "web/src/app/extra.css", ".x {\n  padding: 3px; /* design:allow: hairline offset the design draws at 3px */\n}\n"],
      ["colour words in a script that is not styling", "web/src/components/Banner.tsx", "const props = { color: string, size: number };\nexport type T = { color: Color };\n"],
      ["a test with literal values", "web/src/__tests__/literal.test.tsx", 'expect(el).toHaveStyle("color: #ff0000; padding: 12px");\n'],
    ];

    it.each(fine)("passes %s", (_name, path, content) => {
      inProject(FULL, (p) => {
        p.write(path, content);
        const r = p.sdlc("design", "check");
        expect(r.status, r.out).toBe(0);
      });
    });
  });

  it("reads the style block of a Vue component like a stylesheet, and nothing else in it", () => {
    inProject(NUXT, (p) => {
      p.write("web/app/components/Badge.vue", '<script setup lang="ts">\ndefineProps<{ color: string }>();\n</script>\n\n<template>\n  <span class="b">x</span>\n</template>\n\n<style scoped>\n.b {\n  color: red;\n  padding: 10px;\n}\n</style>\n');
      const r = p.sdlc("design", "check");
      expect(r.status).toBe(1);
      expect(r.out).toContain("Badge.vue:11: the colour name red is hard-coded");
      expect(r.out).toContain("Badge.vue:12: a length is hard-coded in `padding: 10px`");
      expect(r.out).not.toContain("Badge.vue:2:");
      p.write("web/app/components/Badge.vue", '<template>\n  <span class="b" :style="{ color: tone }">x</span>\n</template>\n\n<style scoped>\n.b {\n  color: var(--color-accent);\n}\n</style>\n');
      expect(p.sdlc("design", "check").status).toBe(0);
    });
  });

  describe("fails a Flutter screen that hard-codes a design value", () => {
    const hardCoded: Array<[string, string, RegExp]> = [
      ["a colour literal", "const c = Color(0xFF123456);\n", /extra\.dart:1: a colour is hard-coded \(Color\(0x\)/],
      ["a colour from ARGB", "final c = Color.fromARGB(255, 1, 2, 3);\n", /a colour is hard-coded \(Color\.fromARGB\(\)/],
      ["a named material colour", "final c = Colors.red;\n", /a colour is hard-coded \(Colors\.red\)/],
      ["padding", "const p = EdgeInsets.all(16);\n", /extra\.dart:1: a spacing is hard-coded in `EdgeInsets\.all\(16\)`: use a space token from Tokens/],
      ["padding over several lines", "const p = EdgeInsets.symmetric(\n  horizontal: 12,\n  vertical: Tokens.spaceSm,\n);\n", /extra\.dart:1: a spacing is hard-coded in `EdgeInsets\.symmetric\( horizontal: 12/],
      ["a gap", "const g = SizedBox(height: 8);\n", /a spacing is hard-coded in `SizedBox\(height: 8`/],
      ["a corner radius", "final r = BorderRadius.circular(6.5);\n", /a radius is hard-coded in `BorderRadius\.circular\(6\.5\)`: use a radius token/],
      ["a font size", "const s = TextStyle(fontSize: 14);\n", /a type size is hard-coded in `fontSize: 14`: use a font-size token/],
    ];

    it.each(hardCoded)("%s", (_name, content, expected) => {
      inProject(FLUTTER_ONLY, (p) => {
        p.write("mobile/lib/ui/extra.dart", content);
        const r = p.sdlc("design", "check");
        expect(r.status, r.out).toBe(1);
        expect(r.out).toMatch(expected);
      });
    });

    it("passes tokens, zero and a marked exception, and does not read tests or the generated file", () => {
      inProject(FLUTTER_ONLY, (p) => {
        p.write(
          "mobile/lib/ui/extra.dart",
          [
            "const a = EdgeInsets.all(Tokens.spaceMd);",
            "const b = EdgeInsets.zero;",
            "const c = EdgeInsets.all(0);",
            "const d = SizedBox(height: Tokens.spaceSm, width: 0);",
            "final e = BorderRadius.circular(Tokens.radiusLg);",
            "const f = TextStyle(fontSize: Tokens.fontSizeXl);",
            "final g = Colors.transparent;",
            "final h = Color(0xFF000000); // design:allow: the platform's own black",
            "const i = EdgeInsets.all(12); // design:allow: matches a platform control",
            "",
          ].join("\n"),
        );
        p.write("mobile/test/ui/literal_test.dart", "const x = EdgeInsets.all(16);\nfinal y = Colors.red;\n");
        const r = p.sdlc("design", "check");
        expect(r.status, r.out).toBe(0);
      });
    });
  });

  it("is what `sdlc gates --only repo.design` runs, and what turns red when a screen cheats", () => {
    inProject(FULL, (p) => {
      let r = p.sdlc("gates", "--only", "repo.design");
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain("repo.design");
      p.write("web/src/components/Banner.tsx", 'export const style = { color: "#ff0000" };\n');
      r = p.sdlc("gates", "--only", "repo.design");
      expect(r.status).toBe(1);
    });
  });

  describe("makes a PRD without a UI & design section fail the spec check", () => {
    it("fails FEAT-000 when the section is taken out, and names what to add", () => {
      inProject(WEB_ONLY, (p) => {
        expect(p.sdlc("facts", "--runtime", "none").status, "the shipped example has the section").toBe(0);
        const prd = p.read(".ai/specs/FEAT-000-hello-world/prd.md").replace(/## 6\. UI & design[\s\S]*?(?=## 7\.)/, "");
        p.write(".ai/specs/FEAT-000-hello-world/prd.md", prd);
        const r = p.sdlc("facts", "--runtime", "none");
        expect(r.status).toBe(1);
        expect(r.out).toContain("prd.md has no 'UI & design' section");
        expect(r.out).toContain("No UI change.");
      });
    });

    it("accepts `No UI change.` as a complete section, with or without a number", () => {
      for (const heading of ["## 6. UI & design", "## UI and design", "### 6. UI & Design"]) {
        inProject(WEB_ONLY, (p) => {
          const prd = p.read(".ai/specs/FEAT-000-hello-world/prd.md").replace(/## 6\. UI & design[\s\S]*?(?=## 7\.)/, `${heading}\nNo UI change.\n\n`);
          p.write(".ai/specs/FEAT-000-hello-world/prd.md", prd);
          const r = p.sdlc("facts", "--runtime", "none");
          expect(r.status, `${heading}: ${r.out}`).toBe(0);
        });
      }
    });

    it("a new feature starts with the section, as a TODO that has to be resolved", () => {
      inProject(FULL, (p) => {
        expect(p.sdlc("new", "user-login").status).toBe(0);
        const dir = readFileSync(join(p.dir, ".ai/specs/FEAT-001-user-login/prd.md"), "utf8");
        expect(dir).toMatch(/^## 6\. UI & design$/m);
        expect(dir).toContain("Responsive & accessibility");
        const r = p.sdlc("facts", "--runtime", "none", "--feature", "FEAT-001");
        expect(r.status).toBe(1);
        expect(r.out).toContain("TODO(prd)");
      });
    });

    it("is not asked of a project that turned enforcement off", () => {
      inProject({ ...WEB_ONLY, design: { enforce: false } }, (p) => {
        const prd = p.read(".ai/specs/FEAT-000-hello-world/prd.md");
        expect(prd).not.toContain("UI & design");
        expect(p.sdlc("facts", "--runtime", "none").status).toBe(0);
        p.write("web/src/components/Banner.tsx", 'export const style = { color: "#ff0000" };\n');
        expect(p.sdlc("design", "check").status, "run by hand it still reports").toBe(1);
      });
    });
  });
});
