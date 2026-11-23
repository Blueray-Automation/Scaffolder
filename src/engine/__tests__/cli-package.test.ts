import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adoptProject } from "../adopt/generate";
import { generateProject } from "../generate";
import { scanRepository } from "../../../cli/adopt";

/**
 * The published artefact, not the source: build the standalone package, pack it exactly as `npm publish` would, install the tarball
 * into an empty folder that has nothing to do with this repository, and use it from there. This is what `npx ai-scaffolder` runs.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const root = mkdtempSync(join(tmpdir(), "cli-package-"));
const pkgDir = join(root, "pkg");
const consumer = join(root, "consumer");
let tarball = "";
let packed: { files: Array<{ path: string }>; size: number; unpackedSize: number };

const cliPath = () => join(consumer, "node_modules", "ai-scaffolder", "index.js");
const cli = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cliPath(), ...args], { cwd, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

beforeAll(() => {
  execFileSync(process.execPath, [join(REPO, "scripts", "build-cli.mjs"), "--out", pkgDir, "--version", "9.9.9"], { stdio: "pipe" });
  const out = execFileSync("npm", ["pack", "--json", "--pack-destination", root], { cwd: pkgDir, encoding: "utf8" });
  packed = (JSON.parse(out) as Array<typeof packed & { filename: string }>)[0]!;
  tarball = join(root, (JSON.parse(out) as Array<{ filename: string }>)[0]!.filename);
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  // an install with no dependencies to fetch: works offline, so the test needs no registry
  execFileSync("npm", ["install", tarball, "--offline", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: consumer, stdio: "pipe" });
}, 180_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the packed ai-scaffolder package", () => {
  it("contains exactly the bundle, its package.json, README and LICENSE: no source, templates folder, web UI or dependencies", () => {
    expect(packed.files.map((f) => f.path).sort()).toEqual(["LICENSE", "README.md", "index.js", "package.json"]);
    expect(packed.size).toBeLessThan(1_000_000);
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: "ai-scaffolder", version: "9.9.9", license: "MIT", type: "module", bin: { "ai-scaffolder": "index.js" }, engines: { node: ">=20" } });
    // trusted publishing from GitHub Actions requires this to match the repository that runs .github/workflows/release.yml
    expect(pkg.repository).toEqual({ type: "git", url: "git+https://github.com/Blueray-Automation/Scaffolder.git" });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.private).toBeUndefined();
    expect(readFileSync(join(pkgDir, "LICENSE"), "utf8")).toContain("MIT License");
  });

  it("does not leak the machine it was built on: no home folder, user name, e-mail or absolute source paths", () => {
    const text = readFileSync(join(pkgDir, "index.js"), "utf8");
    for (const secret of [homedir(), userInfo().username, REPO, "@gmail.com", "env -S npx tsx"]) {
      expect(text.includes(secret), `the bundle contains "${secret}"`).toBe(false);
    }
    expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true);
    for (const f of ["package.json", "README.md"]) {
      const body = readFileSync(join(pkgDir, f), "utf8");
      expect(body.includes(homedir()) || body.includes(userInfo().username), f).toBe(false);
    }
  });

  it("installs from the tarball with nothing else and puts the command on the path", () => {
    expect(existsSync(cliPath())).toBe(true);
    if (process.platform !== "win32") expect(existsSync(join(consumer, "node_modules", ".bin", "ai-scaffolder"))).toBe(true);
    expect(existsSync(join(consumer, "node_modules", "ai-scaffolder", "node_modules"))).toBe(false);
  });

  it("answers --version and --help, and names itself ai-scaffolder rather than scaffolder", () => {
    expect(cli(consumer, "--version").out.trim()).toBe("9.9.9");
    for (const flag of ["--help", "-h", "help"]) {
      const r = cli(consumer, flag);
      expect(r.status, flag).toBe(0);
      expect(r.out).toContain("ai-scaffolder adopt     <dir>");
      expect(r.out).not.toMatch(/(^|\s)scaffolder adopt/);
    }
    expect(cli(consumer, "list").out).toContain("python frameworks : fastapi");
  });

  it("adopts a repository from outside this checkout and writes the same files as the source engine", () => {
    const target = join(root, "someone-elses-repo");
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: "shop", scripts: { lint: "eslint .", test: "vitest run" }, devDependencies: { vitest: "1" } }));
    writeFileSync(join(target, "src", "index.js"), "export {};\n");
    writeFileSync(join(target, "CLAUDE.md"), "# notes\n");

    // what the source engine writes for this repository, decided before anything is written
    const expected = adoptProject(scanRepository(target), {});

    const dry = cli(consumer, "adopt", target);
    expect(dry.status).toBe(0);
    expect(dry.out).toContain("Dry run");
    expect(dry.out).toContain("npm run lint");
    expect(existsSync(join(target, ".ai"))).toBe(false);

    const real = cli(consumer, "adopt", target, "--write");
    expect(real.status).toBe(0);
    expect(real.out).toContain("Adopted");

    // byte-for-byte what the source engine produces for the same repository
    expect(expected.files.length).toBeGreaterThan(25);
    for (const f of expected.files) expect(readFileSync(join(target, f.path), "utf8"), f.path).toBe(f.content);
    expect(readFileSync(join(target, "AGENTS.md"), "utf8")).toContain("<!-- scaffolder:begin -->");
    expect(readFileSync(join(target, ".ai", "sdlc.py"), "utf8")).toContain("def cmd_onboard");
    // the written runner is a working program
    const doctor = spawnSync(join(target, ".ai", "sdlc"), ["doctor"], { cwd: target, encoding: "utf8" });
    if (process.platform !== "win32") expect(`${doctor.stdout}${doctor.stderr}`).toContain("baseline");
  });

  it("generates a project from the bundle the same way the source does", () => {
    const out = join(root, "generated-app");
    const r = cli(consumer, "generate", "--out", out, "--set", "web.enabled=false", "--set", "database.type=none");
    expect(r.status).toBe(0);
    const expected = generateProject({ web: { enabled: false }, database: { type: "none" } });
    const files = (dir: string, base = ""): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
    expect(files(out).sort()).toEqual(expected.files.map((f) => f.path).sort());
    const zip = join(root, "app.zip");
    expect(cli(consumer, "generate", "--zip", zip).status).toBe(0);
    expect(readFileSync(zip).subarray(0, 2).toString()).toBe("PK");
  });

  it("fails clearly, not with a stack trace, for the mistakes a first-time user makes", () => {
    const missing = cli(consumer, "adopt", join(root, "nope"));
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("not a folder");
    expect(missing.out).not.toContain("    at ");
    expect(cli(consumer, "adopt").out).toContain("ai-scaffolder adopt <dir>");
    expect(cli(consumer, "frobnicate").status).toBe(64);
  });
});
