import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planOverlay, renderReport, scanRepository, writeOverlay } from "../../../cli/adopt";
import { adoptProject } from "../adopt/generate";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "adopt-cli-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const PROJECT = {
  "package.json": JSON.stringify({ name: "shop", scripts: { lint: "eslint .", test: "vitest run" } }),
  "src/index.ts": "export {};\n",
};

function everything(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, name.name);
      if (name.isDirectory()) walk(full);
      else out.push(full.slice(dir.length + 1));
    }
  };
  walk(dir);
  return out.sort();
}

describe("scanRepository", () => {
  it("skips dependency, build and VCS folders, symlinks and the evidence folder; records a virtual environment without entering it", () => {
    const dir = tree({
      ...PROJECT,
      "node_modules/a/package.json": "{}",
      ".git/HEAD": "ref",
      "dist/out.js": "x",
      ".venv/pyvenv.cfg": "home = /x",
      ".venv/lib/site-packages/dep/pyproject.toml": "[project]",
      ".ai/evidence/run1/report.md": "x",
      ".ai/rules/mine.md": "x",
      ".github/workflows/ci.yml": "x",
    });
    symlinkSync(dir, join(dir, "loop"));
    const snap = scanRepository(dir);
    expect(snap.paths.sort()).toEqual([".ai/rules/mine.md", ".github/workflows/ci.yml", ".venv/pyvenv.cfg", "package.json", "src/index.ts"]);
    expect(snap.name).toBe(dir.split("/").pop());
    expect(snap.read("package.json")).toContain('"shop"');
    expect(snap.read("missing.txt")).toBeUndefined();
  });

  it("does not read huge files", () => {
    const dir = tree({ "big.txt": "x".repeat(600 * 1024) });
    expect(scanRepository(dir).read("big.txt")).toBeUndefined();
  });
});

describe("planning and writing the overlay", () => {
  it("a dry run decides but writes nothing; --write creates the files and marks the launchers executable", () => {
    const dir = tree(PROJECT);
    const before = everything(dir);
    const result = adoptProject(scanRepository(dir));
    const plan = planOverlay(dir, result, false);
    expect(plan.every((p) => p.action === "create")).toBe(true);
    expect(everything(dir)).toEqual(before);

    writeOverlay(dir, plan);
    const after = everything(dir);
    expect(after.filter((f) => !before.includes(f)).every((f) => f.startsWith(".ai/") || f === "AGENTS.md")).toBe(true);
    expect(existsSync(join(dir, ".ai", "sdlc.json"))).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("<!-- scaffolder:begin -->");
    // nothing of the project itself was touched
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(PROJECT["package.json"]);
    expect(everything(dir).filter((f) => !f.startsWith(".ai/") && f !== "AGENTS.md")).toEqual(before);
    if (process.platform !== "win32") {
      expect((spawnSync("test", ["-x", join(dir, ".ai", "sdlc")]).status)).toBe(0);
      expect((spawnSync("test", ["-x", join(dir, ".ai", "sdlc.py")]).status)).toBe(0);
    }
  });

  it("is idempotent: adopting again changes nothing", () => {
    const dir = tree(PROJECT);
    writeOverlay(dir, planOverlay(dir, adoptProject(scanRepository(dir)), false));
    const snapshot = Object.fromEntries(everything(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
    const again = planOverlay(dir, adoptProject(scanRepository(dir)), false);
    expect(again.filter((p) => p.action !== "unchanged")).toEqual([]);
    writeOverlay(dir, again);
    expect(Object.fromEntries(everything(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]))).toEqual(snapshot);
  });

  it("never overwrites a file of yours; --force overwrites only what adopt generates", () => {
    const dir = tree(PROJECT);
    writeOverlay(dir, planOverlay(dir, adoptProject(scanRepository(dir)), false));
    writeFileSync(join(dir, ".ai", "rules", "project.md"), "my own rules\n");
    writeFileSync(join(dir, ".ai", "my-notes.md"), "mine\n");

    const kept = planOverlay(dir, adoptProject(scanRepository(dir)), false);
    expect(kept.find((p) => p.path === ".ai/rules/project.md")?.action).toBe("keep");
    writeOverlay(dir, kept);
    expect(readFileSync(join(dir, ".ai", "rules", "project.md"), "utf8")).toBe("my own rules\n");

    const forced = planOverlay(dir, adoptProject(scanRepository(dir)), true);
    expect(forced.find((p) => p.path === ".ai/rules/project.md")?.action).toBe("overwrite");
    writeOverlay(dir, forced);
    expect(readFileSync(join(dir, ".ai", "rules", "project.md"), "utf8")).toContain("work the way this repository already works");
    expect(readFileSync(join(dir, ".ai", "my-notes.md"), "utf8")).toBe("mine\n"); // not a generated file: never touched
  });

  it("keeps a README that already exists in .ai/ and adds only what is missing", () => {
    const dir = tree({ ...PROJECT, ".ai/README.md": "# my own\n", ".ai/notes.md": "x\n" });
    const result = adoptProject(scanRepository(dir));
    expect(result.detection.existing.aiFiles).toEqual([".ai/README.md", ".ai/notes.md"]);
    const plan = planOverlay(dir, result, false);
    expect(plan.find((p) => p.path === ".ai/README.md")?.action).toBe("keep");
    expect(plan.find((p) => p.path === ".ai/sdlc.py")?.action).toBe("create");
    writeOverlay(dir, plan);
    expect(readFileSync(join(dir, ".ai", "README.md"), "utf8")).toBe("# my own\n");
  });

  it("adds its block to an AGENTS.md that exists without changing the rest, and refreshes it in place", () => {
    const mine = "# Our agents file\n\nAlways use tabs.\n";
    const dir = tree({ ...PROJECT, "AGENTS.md": mine });
    writeOverlay(dir, planOverlay(dir, adoptProject(scanRepository(dir)), false));
    const once = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(once.startsWith(mine.trimEnd())).toBe(true);
    expect(once).toContain("## AI operating system (`.ai/`)");
    const plan = planOverlay(dir, adoptProject(scanRepository(dir)), false);
    expect(plan.find((p) => p.path === "AGENTS.md")?.action).toBe("unchanged");
    // a person edits text outside the block: it survives a refresh
    writeFileSync(join(dir, "AGENTS.md"), once.replace("Always use tabs.", "Always use spaces."));
    writeOverlay(dir, planOverlay(dir, adoptProject(scanRepository(dir), { project: { name: "renamed" } }), false));
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("Always use spaces.");
  });

  it("does not guess when the block markers are broken", () => {
    const dir = tree({ ...PROJECT, "AGENTS.md": "x\n<!-- scaffolder:begin -->\nhalf\n" });
    const plan = planOverlay(dir, adoptProject(scanRepository(dir)), false);
    expect(plan.find((p) => p.path === "AGENTS.md")).toMatchObject({ action: "skip" });
    writeOverlay(dir, plan);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("x\n<!-- scaffolder:begin -->\nhalf\n");
  });

  it("rootFile none leaves the repository root alone", () => {
    const dir = tree(PROJECT);
    writeOverlay(dir, planOverlay(dir, adoptProject(scanRepository(dir), { rootFile: "none" }), false));
    expect(everything(dir).filter((f) => !f.startsWith(".ai/"))).toEqual(["package.json", "src/index.ts"]);
  });
});

describe("the report", () => {
  it("says what it found, what it will not cover, and that a dry run wrote nothing", () => {
    const dir = tree({ ...PROJECT, "docker-compose.yml": "services: {}", "go.mod": "module x" });
    const result = adoptProject(scanRepository(dir));
    const text = renderReport("my-repo", result, planOverlay(dir, result, false), false);
    expect(text).toContain("Dry run for my-repo");
    expect(text).toContain("npm run lint");
    expect(text).toContain("Not covered");
    expect(text).toContain("Go project found");
    expect(text).toContain("nothing was written");
    const done = renderReport("my-repo", result, planOverlay(dir, result, false), true);
    expect(done).toContain("./.ai/sdlc baseline");
    expect(done).toContain(".\\.ai\\sdlc.cmd");
  });
});

describe("scaffolder adopt (the command line)", () => {
  const cli = (...args: string[]) => {
    const r = spawnSync("npx", ["tsx", join(__dirname, "../../../cli/index.ts"), ...args], { encoding: "utf-8", timeout: 60_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it("shows a plan without --write and writes with it", () => {
    const dir = tree(PROJECT);
    const dry = cli("adopt", dir);
    expect(dry.status).toBe(0);
    expect(dry.out).toContain("Dry run");
    expect(existsSync(join(dir, ".ai"))).toBe(false);
    const real = cli("adopt", dir, "--write");
    expect(real.status).toBe(0);
    expect(real.out).toContain("Adopted");
    expect(existsSync(join(dir, ".ai", "sdlc.json"))).toBe(true);
  });

  it("reminds you to put a folder under git before agents change it", () => {
    const plain = tree(PROJECT);
    expect(cli("adopt", plain).out).toContain("not a git repository");
    const withGit = tree({ ...PROJECT, ".git/HEAD": "ref: refs/heads/main\n" });
    expect(cli("adopt", withGit).out).not.toContain("not a git repository");
  });

  it("takes settings from --set and a config file, and rejects bad ones", () => {
    const dir = tree(PROJECT);
    expect(cli("adopt", dir, "--write", "--set", "rootFile=none").status).toBe(0);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    const bad = cli("adopt", tree(PROJECT), "--set", "sdlc.maxIterations=0");
    expect(bad.status).toBe(1);
    expect(bad.out).toContain("sdlc.maxIterations");
    const other = tree(PROJECT);
    const cfg = join(tree({ "adopt.yaml": "gates:\n  exclude: [node.test]\n" }), "adopt.yaml");
    expect(cli("adopt", other, "--write", "--config", cfg).status).toBe(0);
    expect(readFileSync(join(other, ".ai", "sdlc.json"), "utf8")).not.toContain("node.test");
  });

  it("fails clearly for a missing folder or no folder", () => {
    const missing = cli("adopt", "/definitely/not/here");
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("not a folder");
    expect(cli("adopt").status).toBe(64);
    expect(cli("generate", "stray-positional").status).toBe(64);
  });
});
