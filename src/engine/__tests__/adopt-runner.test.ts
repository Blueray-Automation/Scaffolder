import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adopt, cleanup, commit, git, repo, sdlc, write } from "./adopt-helpers";

/**
 * The real thing: adopt a throwaway git repository, then drive the generated runner (`.ai/sdlc`) in it.
 * Gates are tiny `node` scripts, so the tests need nothing but node, npm, git and python3 (all of which the project needs anyway).
 */

afterAll(cleanup);

const baselineOf = (dir: string) => JSON.parse(readFileSync(join(dir, ".ai", "baseline.json"), "utf8")).gates as Record<string, { passed: boolean }>;

/** A project whose gates pass or fail depending on marker files, so a test can break and fix them. */
const SWITCHABLE = {
  "package.json": JSON.stringify({
    name: "switchable",
    scripts: { lint: "node check.js lint", test: "node check.js test", build: "node check.js build" },
  }),
  "check.js": "process.exit(require('fs').existsSync('fail-' + process.argv[2]) ? 1 : 0);\n",
  "fail-test": "",
};

describe.skipIf(process.platform === "win32")("an adopted repository, driven by the generated runner", () => {
  describe("the baseline and the ratchet", () => {
    const dir = repo(SWITCHABLE);
    adopt(dir);

    it("refuses to judge before anyone has recorded what passes today", () => {
      const r = sdlc(dir, "verify");
      expect(r.status).toBe(2);
      expect(r.out).toContain("No baseline yet");
      expect(r.out).toContain("./.ai/sdlc baseline");
    });

    it("doctor checks the programs the gates run, even without an install step, and says the baseline is missing", () => {
      const r = sdlc(dir, "doctor");
      expect(r.out).toMatch(/ok\s+node\b/);
      expect(r.out).toMatch(/ok\s+npm\b/);
      expect(r.out).toContain("baseline");
      expect(r.out).toContain("not recorded yet");
    });

    it("records what passes and what fails today", () => {
      const r = sdlc(dir, "baseline");
      expect(r.status).toBe(0);
      expect(r.out).toContain("3 gate(s) pass, 1 fail");
      expect(r.out).toContain("node.test");
      expect(Object.fromEntries(Object.entries(baselineOf(dir)).map(([id, g]) => [id, g.passed]))).toEqual({
        "node.lint": true,
        "node.test": false,
        "node.build": true,
        "repo.secrets": true,
      });
    });

    it("does not silently re-record: a second baseline needs --tighten or --force", () => {
      const r = sdlc(dir, "baseline");
      expect(r.status).toBe(2);
      expect(r.out).toContain("--tighten");
      expect(r.out).toContain("--force");
    });

    it("verify passes right after the baseline: the failing gate is a known warning, not a blocker", () => {
      const r = sdlc(dir, "verify");
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/WARN\s+node\.test.*known/);
      expect(r.out).toContain("VERIFIED");
      expect(readFileSync(join(dir, ".ai", "evidence", "latest", "report.md"), "utf8")).toContain("Known failures");
    });

    it("a gate that passed at the baseline and fails now is a regression", () => {
      writeFileSync(join(dir, "fail-lint"), "");
      const r = sdlc(dir, "verify");
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/FAIL\s+node\.lint/);
      expect(r.out).toContain("NOT VERIFIED");
      rmSync(join(dir, "fail-lint"));
    });

    it("a known failure that starts to pass is reported, and --tighten locks it in for good", () => {
      rmSync(join(dir, "fail-test"));
      const better = sdlc(dir, "verify");
      expect(better.status).toBe(0);
      expect(better.out).toContain("baseline --tighten");
      const tight = sdlc(dir, "baseline", "--tighten");
      expect(tight.status).toBe(0);
      expect(baselineOf(dir)["node.test"]?.passed).toBe(true);
      writeFileSync(join(dir, "fail-test"), "");
      const worse = sdlc(dir, "verify");
      expect(worse.status).toBe(1);
      expect(worse.out).toMatch(/FAIL\s+node\.test/);
    });

    it("--tighten refuses while something that passed at the baseline is failing", () => {
      const r = sdlc(dir, "baseline", "--tighten");
      expect(r.status).toBe(1);
      expect(r.out).toContain("Not tightened");
      expect(baselineOf(dir)["node.test"]?.passed).toBe(true);
    });

    it("an unfinished spec stub fails verification, but having no spec at all does not", () => {
      rmSync(join(dir, "fail-test"));
      expect(sdlc(dir, "verify").status).toBe(0);
      const made = sdlc(dir, "new", "export-csv");
      expect(made.out).toContain("FEAT-001-export-csv");
      expect(sdlc(dir, "verify").status).toBe(1);
    });
  });

  describe("secrets", () => {
    const fakeKey = 'const key = "AKIA' + 'ABCDEFGHIJKLMNOP";\n';
    const dir = repo({ ...SWITCHABLE, "config.js": fakeKey });
    adopt(dir);

    it("a secret that was already there is recorded as known; a new one fails; moving the old one changes nothing", () => {
      expect(sdlc(dir, "secrets").status).toBe(1); // before the baseline it is new
      expect(sdlc(dir, "baseline").status).toBe(0);
      expect(sdlc(dir, "secrets").status).toBe(0);
      expect(readFileSync(join(dir, ".ai", "secrets.baseline.json"), "utf8")).not.toContain("ABCDEFGHIJKLMNOP"); // the secret itself is never copied

      writeFileSync(join(dir, "config.js"), `// moved down\n\n${fakeKey}`);
      expect(sdlc(dir, "secrets").status).toBe(0);

      writeFileSync(join(dir, "other.js"), 'const t = "ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789AB";\n');
      const r = sdlc(dir, "secrets");
      expect(r.status).toBe(1);
      expect(r.out).toContain("other.js");
      expect(r.out).not.toContain("config.js");
    });
  });

  describe("implement", () => {
    const spec = {
      "prd.md": "# FEAT-001: Ready File\n\nStatus: Approved\n\n## 1. Objective\nA file says ready.\n\n## 2. User stories & acceptance criteria\n- **AC-001** Given the repository, when built, then feature.txt says ready.\n",
      "acceptance.json": JSON.stringify({ feature: "FEAT-001", checks: [{ id: "CHK-001", name: "feature.txt says ready", covers: ["AC-001"], type: "file", path: "feature.txt", contains: ["ready"] }] }),
    };
    const dir = repo({ ...SWITCHABLE, "tsconfig.json": "{}\n" });
    adopt(dir);
    expect(sdlc(dir, "baseline").status).toBe(0);
    write(dir, Object.fromEntries(Object.entries(spec).map(([f, c]) => [`.ai/specs/FEAT-001-ready-file/${f}`, c])));
    commit(dir);
    const reset = () => {
      git(dir, "checkout", "--", ".");
      git(dir, "clean", "-fdq");
    };
    const agent = (script: string) => `sh -c "cat >/dev/null; ${script}"`;

    it("hands the agent the spec and the repository's rules, then proves the result with the same gates and facts", () => {
      const dry = sdlc(dir, "implement", "FEAT-001", "--dry-run", "--agent", "claude");
      expect(dry.status).toBe(0);
      const prompt = readFileSync(join(dir, ".ai", "evidence", dry.out.match(/evidence\/([^/\s]+)\/implement\.prompt\.md/)![1]!, "implement.prompt.md"), "utf8");
      expect(prompt).toContain("existing** repository");
      expect(prompt).toContain("FEAT-001: Ready File");
      expect(prompt).toContain(".ai/baseline.json");
      expect(prompt).not.toContain("{{");

      const r = sdlc(dir, "implement", "FEAT-001", "--agent", agent("echo ready > feature.txt"));
      expect(r.status).toBe(0);
      expect(r.out).toContain("FEAT-001 is implemented and verified");
      expect(r.out).toMatch(/PASS\s+FEAT-001:CHK-001/);
      expect(readFileSync(join(dir, "feature.txt"), "utf8")).toContain("ready");
      reset();
    });

    it("heals: an agent that gets it wrong the first time is sent the failure and gets it right on the next iteration", () => {
      // the first call writes the wrong word; the heal call (a second run of the same agent) writes the right one
      const r = sdlc(dir, "implement", "FEAT-001", "--agent", agent("if [ -f .attempted ]; then echo ready > feature.txt; else touch .attempted; echo nope > feature.txt; fi"));
      expect(r.out).toMatch(/FAIL\s+FEAT-001:CHK-001/);
      expect(r.out).toContain("loop iteration 2/5");
      expect(r.out).toContain("FEAT-001 is implemented and verified");
      expect(r.status).toBe(0);
      reset();
    });

    it("stops with an integrity violation when the agent edits the baseline", () => {
      const r = sdlc(dir, "implement", "FEAT-001", "--agent", agent("echo '{}' > .ai/baseline.json"));
      expect(r.status).toBe(4);
      expect(r.out).toContain("INTEGRITY VIOLATION");
      expect(r.out).toContain(".ai/baseline.json");
      reset();
    });

    it("stops when the agent edits the specification", () => {
      const r = sdlc(dir, "implement", "FEAT-001", "--agent", agent("echo more >> .ai/specs/FEAT-001-ready-file/prd.md"));
      expect(r.status).toBe(4);
      reset();
    });

    it("lists changes to the repository's own lint/type/test configuration for review", () => {
      const r = sdlc(dir, "implement", "FEAT-001", "--agent", agent("echo ready > feature.txt; echo '{\\\"strict\\\": false}' > tsconfig.json"));
      expect(r.status).toBe(0);
      expect(r.out).toContain("changed files that define what is checked");
      expect(r.out).toContain("tsconfig.json");
      reset();
    });

    it("an edit to the spec itself is not 'uncommitted changes outside the spec' (git's first status line starts with a space)", () => {
      writeFileSync(join(dir, ".ai", "specs", "FEAT-001-ready-file", "prd.md"), `${spec["prd.md"]}\nA clarification.\n`);
      const r = sdlc(dir, "implement", "FEAT-001", "--dry-run", "--agent", "claude");
      expect(r.status).toBe(0);
      expect(r.out).not.toContain("uncommitted changes");
      reset();
    });

    it("will not start from a dirty tree: the agent's changes must be reviewable", () => {
      writeFileSync(join(dir, "scratch.txt"), "mine");
      const r = sdlc(dir, "implement", "FEAT-001", "--agent", agent("true"));
      expect(r.status).toBe(2);
      expect(r.out).toContain("uncommitted changes");
      reset();
    });
  });

  describe("an environment that was already there", () => {
    it("`setup` uses an existing node_modules as it is instead of reinstalling over it", () => {
      const dir = repo({
        "package.json": JSON.stringify({ name: "has-deps", scripts: { lint: "node -e 0" }, devDependencies: { left: "1.0.0" } }),
        "package-lock.json": "{}\n",
        "node_modules/left/index.js": "module.exports = 1;\n",
      });
      adopt(dir);
      const r = sdlc(dir, "setup");
      expect(r.status).toBe(0);
      expect(r.out).toContain("already installed, used as it is");
      expect(existsSync(join(dir, "node_modules", "left", "index.js"))).toBe(true);
      expect(sdlc(dir, "sync").out).toContain("up to date");
    });
  });
});
