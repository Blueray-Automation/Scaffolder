import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adoptProject } from "../adopt/generate";
import { snapshotFromFiles } from "../adopt/detect";
import { generateProject } from "../generate";
import { adopt, cleanup, commit, git, repo, scriptedAgent, sdlc, write } from "./adopt-helpers";

/**
 * `sdlc onboard`: an agent drafts a map of the repository and its conventions, the tool checks every claim it can against the
 * repository, a person reviews. The agents here are scripted (a node program that writes fixed files), so what is tested is the
 * tool around the agent: the prompt it builds, the checks it runs, the corrections it sends back, and the files it protects.
 */

afterAll(cleanup);

const ARCH_PATH = ".ai/context/architecture.md";
const CONV_PATH = ".ai/rules/conventions.md";
const STATUS = "Status: Draft (drafted by an agent from the code; a human must review it)";

const PROJECT = {
  "package.json": JSON.stringify({ name: "demo-shop", scripts: { lint: "node -e 0", test: "node -e 0", build: "node -e 0" } }),
  "Makefile": "release:\n\techo release\n",
  "README.md": "# Demo shop\nSells things.\n",
  "CLAUDE.md": "# Claude notes\n\nUse tabs.\n",
  "src/index.js": "export const a = 1;\n",
  "src/util.js": "export const b = 2;\n",
  "src/api/orders.js": "export const orders = [];\n",
  "src/index.test.js": "test\n",
  ".gitignore": "build-output/\nsrc/generated.js\n",
};

/** A draft that satisfies every check: and mentions things that look like paths but are not, which must not be flagged. */
const GOOD_ARCH = `# Architecture
${STATUS}

## Purpose
Demo shop sells things to customers (see \`README.md\`). It is a small JavaScript library with a REST-shaped surface:
it answers \`GET /api/orders\` and sends \`application/json\`, published as \`@acme/demo-shop\`, documented at https://example.com/docs/shop.

## Layout
- **Source** (\`src/\`): all of the code. \`src/index.js\` exports the public values and \`src/util.js\` holds helpers.
- **Orders** (\`src/api/\`): the order handlers, for example \`src/api/orders.js\`; every \`src/*.js\` file is plain ES modules.
- **Tooling** (\`package.json\`): run \`npm run lint\`, \`npm run test\` and \`npm run build\`; releases use \`make release\`.
- **Guidance** (\`CLAUDE.md\`): an existing note that asks for tabs.

## Entry points
- **Library entry**: \`src/index.js\` is what a consumer imports.

## Key flows
An order comes in through \`src/api/orders.js\`, which uses the helpers in \`src/util.js\` (see \`src/util.js:1\`).

\`\`\`text
src/        <- a diagram: paths in code fences are not checked
  made-up/  <- so this one is allowed
\`\`\`

## Open questions
- GUESS: the project is probably consumed as an npm package.
`;

const GOOD_CONV = `# Conventions
${STATUS}

## Conventions
- **Named exports**: values are exported by name, never as a default (\`src/index.js\`, \`src/util.js\`).
- **Tabs**: indentation uses tabs (from \`CLAUDE.md\`).
- **Handlers live in \`src/api/\`**: one file per resource, for example \`src/api/orders.js\`.

## Open questions and conflicts
- \`CLAUDE.md\` asks for tabs, but the files use two spaces. Which is right?
`;

const GOOD = { [ARCH_PATH]: GOOD_ARCH, [CONV_PATH]: GOOD_CONV };

/** Every check that can fail at once. */
const BAD_ARCH = `# Architecture
${STATUS}

## Purpose
A shop.

## Layout
- **Core** (\`lib/core/\`): the core.
- **Helpers** (\`src/missing/util.js\`): helpers, but the file is really \`src/util.js\`.
- **Ghost** (\`ghost.js\`): a bare name that exists nowhere.
- **Everything else** (\`src/*.py\`): python?
- **Nowhere**: an item that points at no file at all.

## Entry points
Run \`npm run deploy\`, or \`make ship\`, or \`./.ai/sdlc frobnicate\`.

## Open questions
- TODO(onboard): fill this in.
`;
const BAD_CONV = `# Notes
no status line, no evidence, one item.

## Conventions
- **Only one**: and it cites \`src/index.js\`.
`;

const newRepo = () => {
  const dir = repo(PROJECT);
  adopt(dir);
  commit(dir);
  return dir;
};

const status = (dir: string, ...args: string[]) => git(dir, "status", "--porcelain", ...args).out.trim();

describe.skipIf(process.platform === "win32")("sdlc onboard", () => {
  it("a dry run builds the prompt (tree, gates, existing guidance, the files to write) and changes nothing", () => {
    const dir = newRepo();
    const r = sdlc(dir, "onboard", "--dry-run", "--agent", "claude");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Dry run");
    expect(r.out).toContain(`${ARCH_PATH}, ${CONV_PATH}`);
    expect(status(dir)).toBe("");
    const prompt = readFileSync(join(dir, ".ai", "evidence", readdirSync(join(dir, ".ai", "evidence")).find((n) => n.endsWith("onboard"))!, "onboard.prompt.md"), "utf8");
    expect(prompt).toContain("src/api/  (1 file)");
    expect(prompt).not.toMatch(/^\.ai\//m); // the overlay is not the project
    expect(prompt).toContain("`npm run lint`");
    expect(prompt).toContain("`CLAUDE.md`"); // existing guidance, to be folded in
    expect(prompt).toContain("scaffolder:begin"); // ...except the generated block in AGENTS.md
    expect(prompt).toContain("There is no earlier draft.");
    expect(prompt).not.toContain("{{");
  });

  it("a good draft passes every check, is kept, and is flagged as a draft until a person reviews it", () => {
    const dir = newRepo();
    const agent = scriptedAgent([GOOD]);
    const r = sdlc(dir, "onboard", "--agent", agent.command);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Draft ready");
    expect(r.out).toMatch(/checked against the repository: \d+ cited path\(s\) exist, 4 command\(s\) are real/);
    expect(r.out).toContain("DRAFT written by an AI");
    expect(readFileSync(join(dir, ARCH_PATH), "utf8")).toContain("Purpose");
    expect(agent.calls()).toBe(1);

    expect(sdlc(dir, "doctor").out).toMatch(/note\s+context\s+\.ai\/context\/architecture\.md: still a draft/);
    for (const f of [ARCH_PATH, CONV_PATH]) writeFileSync(join(dir, f), readFileSync(join(dir, f), "utf8").replace(STATUS, "Status: Reviewed by a person"));
    const reviewed = sdlc(dir, "doctor").out;
    expect(reviewed).toMatch(/ok\s+context\s+\.ai\/context\/architecture\.md/);
    expect(reviewed).not.toContain("still a draft");
  });

  it("later agent prompts include the context, and say when it is still an unreviewed draft", () => {
    const dir = newRepo();
    expect(sdlc(dir, "onboard", "--agent", scriptedAgent([GOOD]).command).status).toBe(0);
    write(dir, {
      ".ai/specs/FEAT-001-x/prd.md": "# FEAT-001: X\n\nStatus: Approved\n\n## 2. User stories & acceptance criteria\n- **AC-001** Given a, when b, then c.\n",
      ".ai/specs/FEAT-001-x/acceptance.json": JSON.stringify({ feature: "FEAT-001", checks: [{ id: "CHK-001", name: "x", covers: ["AC-001"], type: "file", path: "README.md" }] }),
    });
    commit(dir);
    const r = sdlc(dir, "implement", "FEAT-001", "--dry-run", "--agent", "claude");
    expect(r.status).toBe(0);
    expect(r.out).toContain("architecture.md is still an unreviewed draft");
    const prompt = readFileSync(join(dir, ".ai", "evidence", readdirSync(join(dir, ".ai", "evidence")).filter((n) => n.includes("implement")).pop()!, "implement.prompt.md"), "utf8");
    expect(prompt).toContain(".ai/context/architecture.md");
    expect(prompt).toContain(".ai/rules/conventions.md");
    expect(prompt).toContain("trust the code");
  });

  it("sends every problem back to the agent and accepts the corrected draft", () => {
    const dir = newRepo();
    const agent = scriptedAgent([{ [ARCH_PATH]: BAD_ARCH, [CONV_PATH]: BAD_CONV }, GOOD]);
    const r = sdlc(dir, "onboard", "--agent", agent.command);
    expect(r.status).toBe(0);
    expect(agent.calls()).toBe(2);
    // each kind of problem was found and named: the console shows the first ten, the agent is sent all of them
    expect(r.out).toContain("problem(s):");
    const sent = agent.prompt(2);
    for (const expected of [
      "cites `lib/core/`, which does not exist",
      "cites `src/missing/util.js`, which does not exist",
      "cites `ghost.js`, which does not exist",
      "did you mean `src/util.js`?",
      "cites `src/*.py`, which does not exist",
      "no package.json defines a script called deploy",
      "no Makefile defines that target",
      "`sdlc frobnicate`, which is not a command",
      "TODO(onboard)",
      "first lines must include `Status: Draft",
      "missing a section about open questions and conflicts",
      "cites no existing file as evidence",
      "expected at least 3 bold-led items",
    ]) {
      expect(sent, expected).toContain(expected);
    }
    // ...as a fix request, not a fresh start
    expect(sent).toContain("attempt 2 of 3");
    expect(sent).toContain("Never create a file");
  });

  it("gives up after the allowed attempts and says what to do by hand", () => {
    const dir = newRepo();
    const agent = scriptedAgent([{ [ARCH_PATH]: BAD_ARCH, [CONV_PATH]: BAD_CONV }]);
    const r = sdlc(dir, "onboard", "--agent", agent.command, "--max-attempts", "2");
    expect(r.status).toBe(1);
    expect(agent.calls()).toBe(2);
    expect(r.out).toContain("still not valid after 2 attempts");
  });

  it("does not flag what only looks like a path: routes, URLs, MIME types, scoped packages, fenced diagrams", () => {
    // GOOD_ARCH contains all of those and passes (above); this pins the individual cases against the cited-path rule
    const dir = newRepo();
    // a bare file name is fine when a file of that name exists somewhere (agents list files under a folder they have just named)
    const arch = GOOD_ARCH.replace("## Open questions", "## Notes\n`src/api/` holds `orders.js`; `src/` holds `util.js` and `index.js`. Talks to `/api/v1/users`, `text/html`, `read/write`, `v1.2`, `e.g.`, `node.lint`, `@scope/pkg`, `node_modules/x/y.js`, `~/.config`.\n\n## Open questions");
    expect(sdlc(dir, "onboard", "--agent", scriptedAgent([{ [ARCH_PATH]: arch, [CONV_PATH]: GOOD_CONV }]).command).status).toBe(0);
  });

  it("accepts the ways agents name things under a folder they have just named, and what git ignores", () => {
    // found by running a real agent: folder names (`api/`), globs (`*.test.js`), suffixes (`.test.js`) and build outputs
    const dir = newRepo();
    const notes =
      "## Notes\n`src/` has `api/` for handlers; tests are named `*.test.js` (the `.test.js` suffix) and the build writes `build-output/` and `src/generated.js` (both ignored by git).\n\n## Open questions";
    const arch = GOOD_ARCH.replace("## Open questions", notes);
    const r = sdlc(dir, "onboard", "--agent", scriptedAgent([{ [ARCH_PATH]: arch, [CONV_PATH]: GOOD_CONV }]).command);
    expect(r.out).not.toContain("does not exist");
    expect(r.status).toBe(0);
  });

  it("still rejects a folder, glob or suffix that exists nowhere, and a generated file that git does not ignore", () => {
    const dir = newRepo();
    const notes = "## Notes\n`ghost/` and `*.py` and `.rs` and `src/not-ignored.js` are all made up.\n\n## Open questions";
    const arch = GOOD_ARCH.replace("## Open questions", notes);
    const agent = scriptedAgent([{ [ARCH_PATH]: arch, [CONV_PATH]: GOOD_CONV }, GOOD]);
    expect(sdlc(dir, "onboard", "--agent", agent.command).status).toBe(0);
    const sent = agent.prompt(2);
    for (const claim of ["`ghost/`", "`*.py`", "`.rs`", "`src/not-ignored.js`"]) expect(sent, claim).toContain(`cites ${claim}, which does not exist`);
  });

  it("keeps the draft of every attempt in the run folder, so a rejected draft can be read and replayed", () => {
    const dir = newRepo();
    const agent = scriptedAgent([{ [ARCH_PATH]: BAD_ARCH, [CONV_PATH]: BAD_CONV }, GOOD]);
    expect(sdlc(dir, "onboard", "--agent", agent.command).status).toBe(0);
    const run = join(dir, ".ai", "evidence", readdirSync(join(dir, ".ai", "evidence")).filter((n) => /onboard(-\d+)?$/.test(n)).sort().pop()!);
    expect(readFileSync(join(run, "attempt-1", ARCH_PATH), "utf8")).toContain("TODO(onboard)");
    expect(readFileSync(join(run, "attempt-2", ARCH_PATH), "utf8")).toBe(GOOD_ARCH);
  });

  it("protects everything else: the agent may write the two files and nothing more", () => {
    for (const [what, extra] of [
      ["existing guidance (CLAUDE.md)", { "CLAUDE.md": "rewritten\n" }],
      ["the gate configuration", { ".ai/sdlc.json": "{}\n" }],
      ["source code", { "src/index.js": "// edited\n" }],
      ["a new file", { "src/new.js": "x\n" }],
    ] as const) {
      const dir = newRepo();
      const r = sdlc(dir, "onboard", "--agent", scriptedAgent([{ ...GOOD, ...extra }]).command);
      expect(r.status, what).toBe(4);
      expect(r.out, what).toContain("INTEGRITY VIOLATION");
      expect(r.out, what).toContain("Existing guidance files");
    }
  });

  it("stops when the agent says it cannot describe the repository", () => {
    const dir = newRepo();
    const r = sdlc(dir, "onboard", "--agent", scriptedAgent([{ QUESTIONS: "The repository has no code I can read.\n" }]).command);
    expect(r.status).toBe(2);
    expect(r.out).toContain("no code I can read");
  });

  it("will not overwrite drafts that exist; --force redrafts, keeps the old version and tells the agent to keep corrections", () => {
    const dir = newRepo();
    expect(sdlc(dir, "onboard", "--agent", scriptedAgent([GOOD]).command).status).toBe(0);
    const corrected = readFileSync(join(dir, ARCH_PATH), "utf8").replace(STATUS, "Status: Reviewed by a person") + "\nA person's correction.\n";
    writeFileSync(join(dir, ARCH_PATH), corrected);
    commit(dir);

    const refused = sdlc(dir, "onboard", "--agent", scriptedAgent([GOOD]).command);
    expect(refused.status).toBe(2);
    expect(refused.out).toContain("would overwrite your work");
    expect(readFileSync(join(dir, ARCH_PATH), "utf8")).toBe(corrected);

    const agent = scriptedAgent([GOOD]);
    const forced = sdlc(dir, "onboard", "--force", "--agent", agent.command);
    expect(forced.status).toBe(0);
    expect(agent.prompt(1)).toContain("Earlier drafts exist at");
    expect(agent.prompt(1)).toContain("do not discard a person's corrections");
    const kept = join(dir, ".ai", "evidence", readdirSync(join(dir, ".ai", "evidence")).filter((n) => /onboard(-\d+)?$/.test(n)).sort().pop()!, "previous", ARCH_PATH);
    expect(readFileSync(kept, "utf8")).toBe(corrected);
  });

  it("starts only from a clean tree, so the agent's changes can be reviewed", () => {
    const dir = newRepo();
    writeFileSync(join(dir, "scratch.txt"), "mine");
    const r = sdlc(dir, "onboard", "--agent", scriptedAgent([GOOD]).command);
    expect(r.status).toBe(2);
    expect(r.out).toContain("uncommitted changes");
    expect(existsSync(join(dir, ARCH_PATH))).toBe(false);
  });

  it("is only for adopted projects", () => {
    const dir = newRepo();
    const file = join(dir, ".ai", "sdlc.json");
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    delete cfg.onboard;
    writeFileSync(file, JSON.stringify(cfg));
    const r = sdlc(dir, "onboard", "--dry-run");
    expect(r.status).toBe(64);
    expect(r.out).toContain("adopted");
  });
});

describe("what adopt generates for onboard", () => {
  it("wires the two prompts and the two files into sdlc.json, and the prompts use only placeholders the runner fills", () => {
    const result = adoptProject(snapshotFromFiles({ "package.json": JSON.stringify({ name: "x", scripts: { test: "jest" } }) }, "x"));
    const cfg = JSON.parse(result.files.find((f) => f.path === ".ai/sdlc.json")!.content);
    expect(cfg.onboard).toEqual({ architecture: ARCH_PATH, conventions: CONV_PATH });
    expect(cfg.agent.prompts).toMatchObject({ onboard: ".ai/prompts/onboard.md", onboardFix: ".ai/prompts/onboard-fix.md" });
    const filled = {
      onboard: ["architectureFile", "conventionsFile", "questionsFile", "tree", "stack", "gates", "existingGuidance", "previous", "commands"],
      "onboard-fix": ["attempt", "maxAttempts", "errors", "architectureFile", "conventionsFile", "questionsFile", "commands"],
    } as const;
    for (const [name, allowed] of Object.entries(filled)) {
      const text = result.files.find((f) => f.path === `.ai/prompts/${name}.md`)!.content;
      const used = [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];
      // onboard-fix does not receive `commands` from the runner: it must not use it
      const unknown = used.filter((u) => !(allowed as readonly string[]).includes(u));
      expect(unknown, name).toEqual([]);
    }
  });

  it("the fix prompt only uses placeholders the runner passes to it", () => {
    const result = adoptProject(snapshotFromFiles({ "package.json": JSON.stringify({ name: "x", scripts: { test: "jest" } }) }, "x"));
    const text = result.files.find((f) => f.path === ".ai/prompts/onboard-fix.md")!.content;
    const used = [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))].sort();
    // keep in step with cmd_onboard's onboardFix values
    expect(used).toEqual(["architectureFile", "attempt", "conventionsFile", "errors", "maxAttempts", "questionsFile"].concat(used.includes("commands") ? ["commands"] : []).sort());
  });

  it("generated (greenfield) projects have no onboard command or prompts", () => {
    const { files } = generateProject({});
    const cfg = JSON.parse(files.find((f) => f.path === ".ai/sdlc.json")!.content);
    expect(cfg.onboard).toBeUndefined();
    expect(cfg.agent.prompts.onboard).toBeUndefined();
    expect(files.some((f) => f.path.includes("onboard"))).toBe(false);
  });
});
