import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";

/**
 * .github/workflows/release.yml cannot be run here (it needs GitHub and npm), so these tests hold it to what can be checked:
 * its structure (who may do what), and its tag guard, which is a real shell script that is executed against real git repositories.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const text = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");
type Step = { uses?: string; run?: string; name?: string; env?: Record<string, string>; with?: Record<string, unknown>; "working-directory"?: string };
type Job = { needs?: string; permissions?: Record<string, string>; steps: Step[] };
const wf = parse(text) as { on: { push: { tags: string[]; branches?: string[] } } & Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> };
const allSteps = Object.values(wf.jobs).flatMap((j) => j.steps);
const runs = allSteps.flatMap((s) => (s.run ? [s.run] : []));

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("release workflow: who can do what", () => {
  it("runs only when a version tag is pushed, never on branches, pull requests or by hand", () => {
    expect(Object.keys(wf.on)).toEqual(["push"]);
    expect(wf.on.push.branches).toBeUndefined();
    expect(wf.on.push.tags).toEqual(["v[0-9]+.[0-9]+.[0-9]+*"]);
  });

  it("is read-only by default, and only the staging job can get an npm identity", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(wf.jobs.build!.permissions).toBeUndefined();
    expect(wf.jobs.stage!.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(text.match(/id-token/g)).toHaveLength(1); // exactly one grant, in the staging job
  });

  it("the job with the identity runs nothing from the repository: no checkout, no install, no tests, just the package that was built", () => {
    const stage = wf.jobs.stage!;
    expect(stage.needs).toBe("build");
    expect(stage.steps.some((s) => s.uses?.startsWith("actions/checkout"))).toBe(false);
    const stageRuns = stage.steps.flatMap((s) => (s.run ? [s.run] : [])).join("\n");
    expect(stageRuns).not.toMatch(/npm (ci|install(?! --global npm@))|npm test|npm run/);
    expect(stage.steps.some((s) => s.uses?.startsWith("actions/download-artifact"))).toBe(true);
  });

  it("holds no npm token: trusted publishing only", () => {
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
  });

  it("stages, never publishes directly: a maintainer approves on npmjs.com", () => {
    expect(runs.join("\n")).toContain("npm stage publish --access public --tag");
    expect(runs.join("\n")).not.toMatch(/npm publish/);
    expect(runs.join("\n")).not.toMatch(/stage approve/); // OIDC cannot approve, and approving is a person's decision
  });

  it("a pre-release goes to the next tag, never latest", () => {
    const script = runs.find((r) => r.includes("npm stage publish"))!;
    expect(script).toMatch(/\*-\*.*tag=next.*tag=latest/s);
  });

  it("uses a Node and an npm new enough for trusted publishing and staging (Node 22.14+, npm 11.15+)", () => {
    const nodes = allSteps.filter((s) => s.uses?.startsWith("actions/setup-node")).map((s) => String(s.with?.["node-version"]));
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) expect(Number(n.split(".")[0])).toBeGreaterThanOrEqual(22);
    expect(runs.join("\n")).toContain("npm install --global npm@11");
    expect(wf.jobs.stage!.steps.find((s) => s.uses?.startsWith("actions/setup-node"))?.with?.["registry-url"]).toBe("https://registry.npmjs.org");
  });

  it("pins every action to a major version", () => {
    const used = allSteps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(used.length).toBeGreaterThan(3);
    for (const u of used) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@v\d+$/);
  });

  it("never puts ${{ }} inside a script: the tag name is untrusted and reaches the shell as an environment variable", () => {
    for (const r of runs) expect(r).not.toContain("${{");
    const guard = allSteps.find((s) => s.run?.includes("merge-base"))!;
    expect(guard.env).toEqual({ TAG: "${{ github.ref_name }}" });
  });

  it("runs lint, types, every test and the build before it uploads anything, and builds the version the tag names", () => {
    const names = wf.jobs.build!.steps.map((s) => s.run ?? s.uses ?? "");
    const at = (needle: string) => names.findIndex((n) => n.includes(needle));
    expect(at("npm run lint")).toBeGreaterThan(-1);
    expect(at("npm run lint")).toBeLessThan(at("npm run type-check"));
    expect(at("npm run type-check")).toBeLessThan(at("npm test"));
    expect(at("npm test")).toBeLessThan(at("build:cli"));
    expect(at("build:cli")).toBeLessThan(at("actions/upload-artifact"));
    expect(runs.join("\n")).toContain('npm run build:cli -- --version "${TAG#v}"');
  });
});

describe("release workflow: the tag guard (the real script, run against real git repositories)", () => {
  const guard = allSteps.find((s) => s.run?.includes("merge-base"))!.run!;

  /** A clone whose origin has main at commit A; `feature` has one more commit B that is not on main. */
  function setup() {
    const root = mkdtempSync(join(tmpdir(), "release-guard-"));
    dirs.push(root);
    const git = (cwd: string, ...args: string[]) =>
      spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
    const origin = join(root, "origin.git");
    mkdirSync(origin);
    git(origin, "init", "--bare", "-q");
    const work = join(root, "work");
    git(root, "clone", "-q", origin, "work");
    writeFileSync(join(work, "a.txt"), "a");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "A");
    git(work, "branch", "-M", "main");
    git(work, "push", "-q", "origin", "main");
    const onMain = git(work, "rev-parse", "HEAD").stdout.trim();
    git(work, "checkout", "-qb", "feature");
    writeFileSync(join(work, "b.txt"), "b");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "B");
    const offMain = git(work, "rev-parse", "HEAD").stdout.trim();
    return { work, onMain, offMain };
  }
  const runGuard = (cwd: string, tag: string, sha: string) => {
    const r = spawnSync("bash", ["-c", guard], { cwd, encoding: "utf8", env: { ...process.env, TAG: tag, GITHUB_SHA: sha } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it.skipIf(process.platform === "win32")("accepts a version tag on a commit that is on main", () => {
    const { work, onMain } = setup();
    for (const tag of ["v0.1.1", "v10.20.30", "v1.0.0-rc.1"]) expect(runGuard(work, tag, onMain).status, tag).toBe(0);
  });

  it.skipIf(process.platform === "win32")("rejects anything that is not a version tag, including a tag crafted to run commands", () => {
    const { work, onMain } = setup();
    for (const tag of ["v1.2", "1.2.3", "vNext", "v1.2.3.4", "v1.2.3;touch pwned", "v1.2.3$(touch pwned)", "v1.2.3`touch pwned`"]) {
      const r = runGuard(work, tag, onMain);
      expect(r.status, tag).toBe(1);
      expect(r.out).toContain("is not a version tag");
    }
    expect(spawnSync("test", ["-e", join(work, "pwned")]).status).not.toBe(0); // nothing in a tag name was executed
  });

  it.skipIf(process.platform === "win32")("rejects a tag on a commit that is not on main", () => {
    const { work, offMain } = setup();
    const r = runGuard(work, "v0.1.1", offMain);
    expect(r.status).toBe(1);
    expect(r.out).toContain("is not on main");
  });
});
