/**
 * End-to-end proof that what Scaffolder generates actually works.
 *
 * For each scenario it generates a project, installs it, runs every gate, runs the facts against
 * real processes, then exercises the healing loop (heal, no-progress, integrity, human hand-off).
 *
 *   npm run e2e                       # all scenarios
 *   npm run e2e -- --scenario default --keep
 *
 * Needs: python3 >= the scenario's backend version on PATH, node >= 22, network (pip/npm). The flutter-* scenarios also need the
 * Flutter SDK on PATH (they are skipped, and said to be skipped, when it is missing).
 */
import { spawn, spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { strToU8, zipSync } from "fflate";
import { deepMerge, defaultConfig, type ScaffolderConfig } from "../src/engine/config";
import { generateProject } from "../src/engine/generate";
import { OPENAPI_SNAPSHOT, relativeFrom } from "../src/engine/gates";
import { designPlan } from "../src/engine/design";

type Json = Record<string, any>;

// What the generated gates set for themselves; the setup step (flutter pub get) has no such switch, so keep the harness quiet too.
process.env.FLUTTER_SUPPRESS_ANALYTICS ??= "true";

const SCENARIOS: Record<string, Json> = {
  default: {},
  "backend-only-no-db": { web: { enabled: false }, database: { type: "none" } },
  "custom-dirs": { layout: { backendDir: "services/api", webDir: "apps/web" } },
  // The same stack with Nuxt in place of Next.js: its build, its server, and the page asking the backend through its own route.
  "nuxt-fullstack": { web: { framework: "nuxt" } },
  // The same stack with a Flutter app beside the web app: its gates, and its client run against the live backend (AC-008).
  "flutter-fullstack": { mobile: { enabled: true } },
  // A Flutter app on its own: nothing to start, so the spec's checks are named widget tests (see mobileOnlyScenario).
  "flutter-only": { backend: { enabled: false }, web: { enabled: false }, database: { type: "none" }, mobile: { enabled: true } },
};

const { values } = parseArgs({
  options: { scenario: { type: "string", default: "all" }, keep: { type: "boolean", default: false } },
});

let failures = 0;
const log = (msg: string) => console.log(msg);
const ok = (msg: string) => log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  failures++;
  log(`  ✗ ${msg}`);
};

function run(cmd: string, args: string[], cwd: string, opts: SpawnSyncOptions = {}) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: process.env, ...opts } as SpawnSyncOptionsWithStringEncoding);
}

function expectExit(label: string, cwd: string, args: string[], want: number, extraEnv: Record<string, string> = {}) {
  const r = run("./scripts/sdlc", args, cwd, { env: { ...process.env, ...extraEnv } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status === want) ok(`${label} (exit ${want})`);
  else {
    bad(`${label}: expected exit ${want}, got ${r.status}`);
    log(out.split("\n").slice(-25).map((l) => `      ${l}`).join("\n"));
  }
  return out;
}

/**
 * The design contract's negative controls: a screen that hard-codes a value, a generated file somebody edited and a token
 * somebody changed without syncing must each FAIL the gate, and `design sync` must put the project right again.
 */
function designControls(dir: string, cfg: ScaffolderConfig): void {
  const plan = designPlan(cfg);
  if (!plan) return;
  const web = plan.scan[0]?.kind === "web";
  const output = plan.outputs[0];
  const scan = plan.scan[0];
  if (!output || !scan) return bad("a project with a screen has no design plan");
  const cheat = join(dir, scan.root, web ? "e2e-cheat.css" : "e2e-cheat.dart");
  writeFileSync(cheat, web ? ".cheat {\n  color: #ff0000;\n  padding: 12px;\n}\n" : "const cheat = EdgeInsets.all(16);\n");
  const cheated = expectExit("the design gate FAILS for a screen that hard-codes a value", dir, ["gates", "--only", "repo.design"], 1);
  if (cheated.includes("e2e-cheat") || readFileSync(join(dir, ".ai/evidence/latest/logs/repo.design.log"), "utf8").includes("e2e-cheat")) ok("the failure names the file");
  else bad("the hard-coded value was not named");
  rmSync(cheat);
  expectExit("the design gate passes again without it", dir, ["gates", "--only", "repo.design"], 0);

  const generated = join(dir, output.path);
  const original = readFileSync(generated, "utf8");
  writeFileSync(generated, `${original}// edited by hand\n`);
  expectExit("the design gate FAILS for a generated file somebody edited", dir, ["design", "check"], 1);
  writeFileSync(generated, original);

  const tokensPath = join(dir, plan.tokens);
  const tokens = readFileSync(tokensPath, "utf8");
  writeFileSync(tokensPath, tokens.replace("#4f46e5", "#0ea5e9"));
  expectExit("the design gate FAILS for a token changed without a sync", dir, ["design", "check"], 1);
  expectExit("design sync regenerates the files from the tokens", dir, ["design", "sync"], 0);
  if (readFileSync(generated, "utf8").toLowerCase().includes(web ? "#0ea5e9" : "0xff0ea5e9")) ok("the new colour is in the generated file");
  else bad("the new colour did not reach the generated file");
  expectExit("and the gate is green with the new tokens", dir, ["gates", "--only", "repo.design"], 0);
  writeFileSync(tokensPath, tokens);
  expectExit("sync back to the original tokens", dir, ["design", "sync"], 0);
}

function pythonVersion(): string {
  const r = run("python3", ["-c", "import sys;print('%d.%d'%sys.version_info[:2])"], process.cwd());
  return (r.stdout ?? "").trim();
}

const versionAtLeast = (have: string, want: string) => {
  const [a1 = 0, a2 = 0] = have.split(".").map(Number);
  const [b1 = 0, b2 = 0] = want.split(".").map(Number);
  return a1 > b1 || (a1 === b1 && a2 >= b2);
};

function scenario(name: string, patch: Json): void {
  log(`\n=== scenario: ${name} ===`);
  const cfg = deepMerge(defaultConfig(), patch);
  const result = generateProject(cfg);
  if (result.issues.some((i) => i.level === "error")) return bad(`config invalid: ${JSON.stringify(result.issues)}`);
  if (cfg.mobile.enabled && run("flutter", ["--version"], process.cwd()).status !== 0) {
    return log("  - the Flutter SDK is not on PATH: this scenario was NOT exercised (install it, then run again)");
  }
  if (!cfg.backend.enabled && !cfg.web.enabled) return mobileOnlyScenario(name, cfg, result);
  const need = cfg.backend.version;
  const have = pythonVersion();
  if (!versionAtLeast(have, need)) {
    return bad(`python3 ${have} on PATH, scenario needs >= ${need} (put a newer python3 first on PATH)`);
  }

  const dir = mkdtempSync(join(tmpdir(), `scaffolder-e2e-${name}-`));
  try {
    for (const f of result.files) {
      const full = join(dir, f.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.content);
      if (f.executable) chmodSync(full, 0o755);
    }
    ok(`generated ${result.files.length} files in ${dir}`);

    const git = (...a: string[]) => run("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", ...a], dir);
    git("init", "-q");

    expectExit("doctor", dir, ["doctor"], 0);

    // --- a too-old Python must produce guidance, never a raw pip error; an explicit new one is accepted ---
    const fakePython = (version: string) => {
      const file = join(dir, "..", `fake-python-${version}-${name}.sh`);
      writeFileSync(file, `#!/bin/sh\necho ${version}\n`);
      chmodSync(file, 0o755);
      return file;
    };
    const tooOld = expectExit("setup refuses a too-old Python", dir, ["setup"], 1, { SDLC_PYTHON: fakePython("3.9") });
    if (tooOld.includes(`Python >= ${cfg.backend.version}`) && tooOld.includes("SDLC_PYTHON") && !tooOld.includes("pip")) {
      ok("it explains the problem and the fix instead of a raw pip error");
    } else bad("too-old Python message did not explain the fix");
    const oldDoctor = expectExit("doctor reports a too-old Python", dir, ["doctor"], 1, { SDLC_PYTHON: fakePython("3.9") });
    if (oldDoctor.includes("MISS") && oldDoctor.includes(`python>=${cfg.backend.version}`)) ok("doctor names the missing Python");
    else bad("doctor did not name the missing Python");
    const okDoctor = expectExit("doctor accepts a new-enough Python", dir, ["doctor"], 0, { SDLC_PYTHON: fakePython(cfg.backend.version) });
    if (okDoctor.includes(`Python ${cfg.backend.version}`)) ok("doctor shows which interpreter it will use");
    else bad("doctor did not show the interpreter");

    expectExit("setup (pip + npm install)", dir, ["setup"], 0);
    if (!cfg.web.enabled) expectExit("setup again is idempotent (stale venv is replaced)", dir, ["setup"], 0);
    git("add", "-A");
    git("commit", "-qm", "baseline");

    expectExit("gates: lint, types, unit+coverage, build, contract, security", dir, ["gates", "--keep-going"], 0);

    const facts = expectExit("facts against real local processes", dir, ["facts", "--runtime", "local"], 0);
    const hasDb = cfg.database.type !== "none";
    const skipped = (facts.match(/\bSKIP\b/g) ?? []).length;
    if (skipped === (hasDb ? 1 : 0)) ok(`skips are honest (${skipped}: DB-dependent check is not claimed as passed)`);
    else bad(`expected ${hasDb ? 1 : 0} skipped checks, saw ${skipped}`);
    const results = JSON.parse(readFileSync(join(dir, ".ai/evidence/latest/results.json"), "utf8")) as Json;
    if (results.passed === true) ok("evidence results.json says passed");
    else bad("evidence results.json does not say passed");

    // --- post-deploy path: facts against an already-running "live" URL, without starting anything ---
    if (cfg.web.enabled) {
      const port = 38000 + Math.floor(Math.random() * 1000);
      const serve = (body: string) =>
        spawn(process.execPath, ["-e", `require("http").createServer((q,r)=>r.end(${JSON.stringify(body)})).listen(${port},"127.0.0.1")`], {
          stdio: "ignore",
        });
      const live = ["--no-runtime", "--base-url", `web=http://127.0.0.1:${port}`, "--label", "deployed"];

      let server = serve("<h1>Hello, World!</h1>");
      run("sleep", ["1"], dir);
      expectExit("post-deploy facts pass against a live URL", dir, ["facts", ...live], 0);
      const deployed = JSON.parse(readFileSync(join(dir, ".ai/evidence/latest/results.json"), "utf8")) as Json;
      const byId = (id: string) => (deployed.items as Json[]).find((i) => i.id === `FEAT-000:${id}`);
      if (byId("CHK-008")?.status === "pass") ok("the web fact ran against the live URL");
      else bad("web fact did not pass against the live URL");
      if (byId("CHK-001")?.status === "skip") ok("backend facts are skipped (no backend URL), not faked");
      else bad("backend fact was not skipped for a live web-only target");
      if (byId("CHK-007")?.status === "skip" && byId("CHK-007")?.notApplicable) ok("repository checks are skipped as not applicable");
      else bad("repository check was not marked not-applicable");
      server.kill();

      server = serve("<h1>Something else</h1>");
      run("sleep", ["1"], dir);
      expectExit("post-deploy facts FAIL when the live page is wrong", dir, ["facts", ...live], 1);
      server.kill();
    }

    // --- the real thing: build the images and check every fact against the compose stack ---
    if (cfg.docker.enabled && cfg.sdlc.runtime === "docker") {
      if (run("docker", ["info"], dir).status === 0) {
        expectExit("facts against the docker compose stack (builds images)", dir, ["facts"], 0);
        const dockerResults = JSON.parse(readFileSync(join(dir, ".ai/evidence/latest/results.json"), "utf8")) as Json;
        const items = dockerResults.items as Json[];
        const ready = items.find((i) => i.id === "FEAT-000:CHK-005");
        if (dockerResults.passed === true && !items.some((i) => i.status === "skip")) {
          ok("nothing skipped: the readiness fact ran against real PostgreSQL");
        } else {
          bad(`docker facts did not fully pass (CHK-005: ${ready?.status ?? "missing"}, skips: ${items.filter((i) => i.status === "skip").length})`);
        }
      } else {
        log("  - docker daemon not running: Dockerfiles, compose stack and docker-mode facts were NOT exercised");
      }
    }

    // --- healing loop: break the code, let a scripted "agent" repair it ---
    const hello = join(cfg.layout.backendDir, "app/api/v1/hello.py");
    const good = readFileSync(join(dir, hello), "utf8");
    const goodCopy = join(dir, "..", `good-${name}.py`);
    writeFileSync(goodCopy, good);
    const fakeAgent = join(dir, "..", `agent-${name}.sh`);
    writeFileSync(fakeAgent, `#!/usr/bin/env bash\ncat >/dev/null\ncp '${goodCopy}' '${join(dir, hello)}'\n`);
    chmodSync(fakeAgent, 0o755);
    const loop = ["loop", "--stage", "unit", "--only", "backend.unit"];
    const breakCode = () => writeFileSync(join(dir, hello), good.replace("Hello,", "Hi,"));

    breakCode();
    expectExit("loop heals a regression via the agent", dir, [...loop, "--agent", fakeAgent], 0);
    if (readFileSync(join(dir, hello), "utf8") === good) ok("agent's fix is on disk");
    else bad("agent fix not on disk");

    breakCode();
    expectExit("loop without an agent hands over to a human", dir, [...loop, "--agent", ""], 2);
    expectExit("loop stops when the agent makes no progress", dir, [...loop, "--agent", "true"], 3);
    expectExit(
      "loop stops when the agent tampers with the spec",
      dir,
      [...loop, "--agent", "echo >> .ai/specs/FEAT-000-hello-world/acceptance.json"],
      4,
    );
    git("checkout", "-q", "--", ".ai/specs");
    expectExit(
      "loop stops when the agent tampers with the gate config",
      dir,
      [...loop, "--agent", "echo >> .ai/sdlc.json"],
      4,
    );
    git("checkout", "-q", "--", ".ai/sdlc.json");
    writeFileSync(join(dir, hello), good);
    expectExit("verification is green again after restoring", dir, ["gates", "--stage", "unit"], 0);

    // --- an unverified requirement must fail verification ---
    const prdPath = join(dir, ".ai/specs/FEAT-000-hello-world/prd.md");
    const prd = readFileSync(prdPath, "utf8");
    writeFileSync(prdPath, `${prd}\n- **AC-900** Given anything, when anything, then nothing is verified.\n`);
    const out = expectExit("facts reject a criterion that has no check", dir, ["facts", "--runtime", "none"], 1);
    if (out.includes("AC-900 has no check")) ok("failure names the unverified criterion");
    else bad("failure did not name AC-900");
    writeFileSync(prdPath, prd);

    // --- secrets gate catches a committed credential ---
    writeFileSync(join(dir, "leak.txt"), `aws_key = AKIA${"ABCDEFGHIJKLMNOP"}\n`);
    expectExit("secret scan catches a committed key", dir, ["secrets"], 1);
    rmSync(join(dir, "leak.txt"));

    // --- the design contract ---
    if (cfg.web.enabled) designControls(dir, cfg);

    // --- sdlc implement: spec in, verified code out, with a scripted agent standing in for the AI ---
    implementFromSpec(dir, cfg, git, name);
    specFromDocument(dir, cfg, git, name);
  } finally {
    if (values.keep) log(`  kept: ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}


// ---------------------------------------------------------------------------------------------
// A Flutter app on its own. There is no server to start, so the spec's checks run named widget tests, and the
// things worth proving are that every gate runs, that each check can really fail, and that the platform folders
// (`flutter create`) leave the project green. Needs only the Flutter SDK.
// ---------------------------------------------------------------------------------------------

function mobileOnlyScenario(name: string, cfg: Json, result: ReturnType<typeof generateProject>): void {
  const dir = mkdtempSync(join(tmpdir(), `scaffolder-e2e-${name}-`));
  const mobile = join(dir, cfg.layout.mobileDir);
  const read = (path: string) => readFileSync(join(dir, path), "utf8");
  try {
    for (const f of result.files) {
      const full = join(dir, f.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.content);
      if (f.executable) chmodSync(full, 0o755);
    }
    ok(`generated ${result.files.length} files in ${dir}`);
    const git = (...a: string[]) => run("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", ...a], dir);
    git("init", "-q");
    // Docker and CD have nothing to act on without a service: the generator leaves them out whatever the config said.
    const written = JSON.parse(readFileSync(join(dir, ".ai/sdlc.json"), "utf8")) as Json;
    if (!result.files.some((f) => f.path === "docker-compose.yml" || f.path.startsWith(".github/workflows/cd")) && written.runtime.mode === "none") {
      ok("no compose file, no CD workflow, runtime none: nothing to containerize");
    } else bad("a mobile-only project got Docker or CD files");

    const doctor = expectExit("doctor finds the Flutter SDK", dir, ["doctor"], 0);
    if (/ok\s+flutter/.test(doctor)) ok("doctor lists flutter among the tools it checked");
    else bad("doctor did not check for flutter");
    expectExit("setup (flutter pub get)", dir, ["setup"], 0);
    git("add", "-A");
    git("commit", "-qm", "baseline");

    expectExit("gates: analysis + format, tests with the coverage floor, build check, secrets", dir, ["gates", "--keep-going"], 0);
    const facts = expectExit("facts: the spec's named widget tests", dir, ["facts"], 0);
    const results = JSON.parse(read(".ai/evidence/latest/results.json")) as Json;
    const items = results.items as Json[];
    if (results.passed === true && items.filter((i) => i.kind === "fact" && i.status === "pass").length >= 4 && !facts.includes("SKIP")) {
      ok("the traceability check and every named-test check passed, none skipped");
    } else bad("facts did not all pass without skips");

    // --- a check must be able to fail: break the code, then break a check's link to its test ---
    const greeting = join(cfg.layout.mobileDir, "lib/greeting.dart");
    const good = read(greeting);
    writeFileSync(join(dir, greeting), good.replace("'World'", "'Earth'"));
    expectExit("facts FAIL when the greeting is wrong", dir, ["facts"], 1);
    expectExit("the unit gate fails too", dir, ["gates", "--stage", "unit"], 1);
    writeFileSync(join(dir, greeting), good);

    const pageTest = join(cfg.layout.mobileDir, "test/ui/hello_page_test.dart");
    const goodTest = read(pageTest);
    writeFileSync(join(dir, pageTest), goodTest.replace("AC-002: typing", "AC-902: typing"));
    const orphan = expectExit("facts FAIL when a check's test no longer exists (flutter test ran nothing)", dir, ["facts"], 1);
    if (orphan.includes("exit 79")) ok("it fails because no test matched, not by luck");
    else bad("the missing test was not reported as 'no tests ran'");
    writeFileSync(join(dir, pageTest), goodTest);

    // --- the coverage floor counts a file that no test loads, which `flutter test --coverage` alone would never list ---
    writeFileSync(join(mobile, "lib/untested.dart"), "int double(int n) => n * 2;\n");
    const unloaded = expectExit("the unit gate FAILS for a lib file no test uses", dir, ["gates", "--only", "mobile.unit"], 1);
    if (unloaded.includes("untested.dart is not loaded by any test") || read(".ai/evidence/latest/logs/mobile.unit.log").includes("untested.dart is not loaded by any test")) {
      ok("the failure names the file");
    } else bad("the unloaded file was not named");
    rmSync(join(mobile, "lib/untested.dart"));

    // --- the healing loop works for a Dart gate: a scripted agent restores the file ---
    const goodCopy = join(dir, "..", `good-${name}.dart`);
    writeFileSync(goodCopy, good);
    const fakeAgent = join(dir, "..", `agent-${name}.sh`);
    writeFileSync(fakeAgent, `#!/usr/bin/env bash\ncat >/dev/null\ncp '${goodCopy}' '${join(dir, greeting)}'\n`);
    chmodSync(fakeAgent, 0o755);
    writeFileSync(join(dir, greeting), good.replace("'World'", "'Earth'"));
    expectExit("loop heals a regression in the Dart code via the agent", dir, ["loop", "--stage", "unit", "--only", "mobile.unit", "--agent", fakeAgent], 0);
    if (read(greeting) === good) ok("agent's fix is on disk");
    else bad("agent fix not on disk");

    // --- an unverified requirement must fail verification ---
    const prdPath = join(dir, ".ai/specs/FEAT-000-hello-world/prd.md");
    const prd = readFileSync(prdPath, "utf8");
    writeFileSync(prdPath, `${prd}\n- **AC-900** Given anything, when anything, then nothing is verified.\n`);
    const unchecked = expectExit("facts reject a criterion that has no check", dir, ["facts"], 1);
    if (unchecked.includes("AC-900 has no check")) ok("failure names the unverified criterion");
    else bad("failure did not name AC-900");
    writeFileSync(prdPath, prd);

    writeFileSync(join(dir, "leak.txt"), `aws_key = AKIA${"ABCDEFGHIJKLMNOP"}\n`);
    expectExit("secret scan catches a committed key", dir, ["secrets"], 1);
    rmSync(join(dir, "leak.txt"));

    // --- the design contract ---
    designControls(dir, cfg as ScaffolderConfig);

    // --- the platform folders: `flutter create` must not break or rewrite what was generated ---
    const shipped = (root: string) =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && !/(^|\/)(build|\.dart_tool|coverage|android|ios|\.idea|pubspec\.lock)(\/|$)/.test(join(e.parentPath, e.name).slice(root.length)))
        .map((e) => join(e.parentPath, e.name));
    const before = new Map(shipped(mobile).map((p) => [p, readFileSync(p, "utf8")]));
    const created = run("flutter", ["create", "--platforms=android,ios", "--org", "com.example", "--project-name", cfg.project.name.replace(/-/g, "_"), "."], mobile);
    if (created.status === 0) ok("flutter create writes the android/ and ios/ folders");
    else bad(`flutter create failed: ${created.stderr}`);
    const changed = [...before].filter(([p, text]) => !existsSync(p) || readFileSync(p, "utf8") !== text).map(([p]) => p.slice(mobile.length + 1));
    if (changed.length === 0) ok("it left every generated file as it was (analysis_options.yaml, tests, README, pubspec.yaml)");
    else bad(`flutter create changed or removed: ${changed.join(", ")}`);
    // It does re-resolve and rewrite pubspec.lock (so the docs say to commit the result); CI installs with --enforce-lockfile.
    if (run("flutter", ["pub", "get", "--enforce-lockfile"], mobile).status === 0) ok("the lockfile it leaves satisfies CI's `flutter pub get --enforce-lockfile`");
    else bad("the lockfile left by flutter create does not satisfy --enforce-lockfile");
    expectExit("every gate still passes with the platform folders present", dir, ["gates", "--keep-going"], 0);
  } finally {
    if (values.keep) log(`  kept: ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// `sdlc implement`: the user writes only prd.md + acceptance.json; an agent does the rest.
// The agent here is a script that does what a good real one is told to do (tests first, code, a NEW
// dependency, `sdlc sync`, contract update), so the whole pipeline around the agent is exercised.
// ---------------------------------------------------------------------------------------------

const SLUG_PRD = `# FEAT-001: Slug endpoint

Status: Accepted

## 1. Objective
Turn free text into a URL-friendly slug.

## 2. User stories & acceptance criteria
- **AC-001** Given text "Hello World", when a client requests \`GET /api/v1/slug?text=Hello World\`, then it responds \`200\` with \`{"slug": "hello-world"}\`.
- **AC-002** Given accented text "Crème Brûlée", when a client requests the slug, then it responds \`200\` with \`{"slug": "creme-brulee"}\`.
- **AC-003** Given no \`text\` parameter, when a client requests \`GET /api/v1/slug\`, then it responds \`422\`.

## 3. Permissions & roles
Public, read-only.

## 4. Data & validation
\`text\`: required string, 1 to 200 characters.

## 5. Contract impact
New endpoint \`GET /api/v1/slug\`. No migrations.

## 6. UI & design
No UI change.

## 7. Out of scope
Custom separators, uniqueness, persistence.

## 8. Verification map
See acceptance.json.
`;

const slugChecks = [
  { id: "CHK-001", name: "Plain text", covers: ["AC-001"], path: "/api/v1/slug?text=Hello%20World", expect: { status: 200, json: { slug: "hello-world" } } },
  { id: "CHK-002", name: "Accents are transliterated", covers: ["AC-002"], path: "/api/v1/slug?text=Cr%C3%A8me%20Br%C3%BBl%C3%A9e", expect: { status: 200, json: { slug: "creme-brulee" } } },
  { id: "CHK-003", name: "Missing text is rejected", covers: ["AC-003"], path: "/api/v1/slug", expect: { status: 422 } },
].map((c) => ({ ...c, type: "http", target: "backend" }));

const SLUG_ACCEPTANCE = JSON.stringify({ feature: "FEAT-001", checks: slugChecks }, null, 2) + "\n";

/** A scripted "agent": reads the prompt on stdin and implements FEAT-001 the way the prompt tells a real agent to. */
const SLUG_AGENT = `import os, pathlib, re, subprocess, sys

prompt = sys.stdin.read()
for needle in ("AC-001", "CHK-002", "Hello World", "./scripts/sdlc sync"):
    if needle not in prompt:
        print("the prompt is missing: " + needle)
        sys.exit(3)

mode = os.environ.get("AGENT_MODE", "implement")
root = pathlib.Path.cwd()
backend = root / os.environ["BACKEND_DIR"]

if mode == "tamper":  # tries to rewrite the requirements: must be stopped
    prd = next((root / ".ai/specs").glob("FEAT-001-*/prd.md"))
    prd.write_text(prd.read_text() + "\\n- **AC-999** Everything passes.\\n")
    sys.exit(0)

if mode == "noop":  # the code already satisfies the spec: nothing to write
    sys.exit(0)

if mode == "ask":  # the spec is unclear: ask instead of guessing
    match = re.search(r"\`([^\`]*QUESTIONS\\.md)\`", prompt)
    pathlib.Path(match.group(1)).write_text("Should slugs keep underscores? I would otherwise assume they become hyphens.\\n")
    sys.exit(0)

(backend / "app/schemas/slug.py").write_text("from pydantic import BaseModel\\n\\n\\nclass SlugResponse(BaseModel):\\n    slug: str\\n")
(backend / "app/api/v1/slug.py").write_text(
    "from typing import Annotated\\n\\nfrom fastapi import APIRouter, Query\\nfrom slugify import slugify\\n\\n"
    "from app.schemas.slug import SlugResponse\\n\\nrouter = APIRouter(prefix=\\"/slug\\", tags=[\\"slug\\"])\\n\\n\\n"
    "@router.get(\\"\\", response_model=SlugResponse, summary=\\"Make a URL slug\\")\\n"
    "async def make_slug(text: Annotated[str, Query(min_length=1, max_length=200)]) -> SlugResponse:\\n"
    "    return SlugResponse(slug=slugify(text))\\n"
)
router = backend / "app/api/v1/router.py"
router.write_text(
    router.read_text()
    .replace("from app.api.v1 import hello", "from app.api.v1 import hello, slug")
    .replace("api_router.include_router(hello.router)", "api_router.include_router(hello.router)\\napi_router.include_router(slug.router)")
)
(backend / "tests/test_slug.py").write_text(
    "from fastapi.testclient import TestClient\\n\\n\\n"
    "def test_slug_lowercases_and_hyphenates(client: TestClient) -> None:\\n"
    "    response = client.get(\\"/api/v1/slug\\", params={\\"text\\": \\"Hello World\\"})\\n\\n"
    "    assert response.json() == {\\"slug\\": \\"hello-world\\"}\\n\\n\\n"
    "def test_slug_transliterates_accents(client: TestClient) -> None:\\n"
    "    response = client.get(\\"/api/v1/slug\\", params={\\"text\\": \\"Cr\\u00e8me Br\\u00fbl\\u00e9e\\"})\\n\\n"
    "    assert response.json() == {\\"slug\\": \\"creme-brulee\\"}\\n\\n\\n"
    "def test_slug_requires_text(client: TestClient) -> None:\\n"
    "    assert client.get(\\"/api/v1/slug\\").status_code == 422\\n"
)

# a NEW dependency: edit the manifest, then install it the way the prompt says
pyproject = backend / "pyproject.toml"
pyproject.write_text(pyproject.read_text().replace('"pydantic-settings>=2.6,<3",\\n', '"pydantic-settings>=2.6,<3",\\n    "python-slugify>=8,<9",\\n'))
subprocess.run(["./scripts/sdlc", "sync"], cwd=root, check=True)

venv = backend / ".venv/bin"
subprocess.run([str(venv / "ruff"), "format", "."], cwd=backend, check=True)
subprocess.run([str(venv / "python"), "-m", "app.export_openapi", "--write", os.environ["OPENAPI_REL"]], cwd=backend, check=True)
print("implemented FEAT-001")
`;

function implementFromSpec(dir: string, cfg: Json, git: (...a: string[]) => unknown, name: string): void {
  log("  -- sdlc implement --");
  const agentFile = join(dir, "..", `slug-agent-${name}.py`);
  writeFileSync(agentFile, SLUG_AGENT);
  const agent = `python3 ${agentFile}`;
  const env = { BACKEND_DIR: cfg.layout.backendDir, OPENAPI_REL: relativeFrom(cfg.layout.backendDir, OPENAPI_SNAPSHOT) };
  const specDir = () => readdirSync(join(dir, ".ai/specs")).find((d) => d.startsWith("FEAT-001-"));
  const headCount = () => run("git", ["rev-list", "--count", "HEAD"], dir).stdout.trim();

  git("add", "-A");
  git("commit", "-qm", "chore: clean tree before implement");

  // sync: install only when a manifest changed (and never reinstall when nothing did)
  expectExit("sync is a no-op when nothing changed", dir, ["sync"], 0);
  const pyproject = join(dir, cfg.layout.backendDir, "pyproject.toml");
  const originalPyproject = readFileSync(pyproject, "utf8");
  writeFileSync(pyproject, originalPyproject.replace('"pydantic-settings>=2.6,<3",\n', '"pydantic-settings>=2.6,<3",\n    "pyjwt>=2.9,<3",\n'));
  const synced = expectExit("sync installs a dependency added to the manifest", dir, ["sync"], 0);
  if (synced.includes("installing dependencies") && run(join(dir, cfg.layout.backendDir, ".venv/bin/python"), ["-c", "import jwt"], dir).status === 0) {
    ok("the new dependency is importable without running setup by hand");
  } else bad("sync did not install the new dependency");
  writeFileSync(pyproject, originalPyproject);
  expectExit("sync again after reverting the manifest", dir, ["sync"], 0);

  // guardrails before any agent runs
  expectExit("implement refuses an unknown feature", dir, ["implement", "FEAT-009", "--agent", agent], 2, env);
  const example = expectExit("implement refuses the worked example FEAT-000", dir, ["implement", "FEAT-000", "--agent", agent], 2, env);
  if (example.includes("worked example") && example.includes("already built") && example.includes("./scripts/sdlc verify")) ok("it says FEAT-000 is already built and what to do instead");
  else bad("the worked example was refused without an explanation");
  if (run("git", ["status", "--porcelain"], dir).stdout.trim() === "") ok("and it changed nothing");
  else bad("refusing the worked example left changes behind");
  expectExit("new feature spec", dir, ["new", "slug-endpoint"], 0);
  const stub = expectExit("implement refuses an unfinished spec", dir, ["implement", "FEAT-001", "--agent", agent], 2, env);
  if (stub.includes("TODO(prd)")) ok("it says the PRD is still a stub");
  else bad("stub PRD was not named");
  const specPath = join(dir, ".ai/specs", specDir() ?? "");
  writeFileSync(join(specPath, "prd.md"), SLUG_PRD);
  writeFileSync(join(specPath, "acceptance.json"), SLUG_ACCEPTANCE);

  const missing = expectExit("implement reports an agent that is not installed", dir, ["implement", "FEAT-001", "--agent", "definitely-not-installed-agent-xyz"], 2, env);
  if (missing.includes("not installed")) ok("it names the missing program and how to fix it");
  else bad("missing agent was not explained");
  writeFileSync(join(dir, "stray.txt"), "uncommitted\n");
  expectExit("implement refuses a dirty tree outside the spec", dir, ["implement", "FEAT-001", "--agent", agent], 2, env);
  rmSync(join(dir, "stray.txt"));
  const dry = expectExit("implement --dry-run runs nothing", dir, ["implement", "FEAT-001", "--agent", agent, "--dry-run"], 0, env);
  const promptFile = (dry.match(/prompt\s+:\s+(\S+)/) ?? [])[1];
  const promptText = promptFile ? readFileSync(join(dir, promptFile), "utf8") : "";
  if (promptText.includes("AC-001") && promptText.includes("CHK-002") && promptText.includes("Hello World") && !promptText.includes("{{")) {
    ok("the prompt contains the PRD and acceptance.json, fully filled in");
  } else bad("the prompt is missing the spec or has unfilled placeholders");

  // the agent may not touch the spec; an unclear spec makes it ask instead of guess
  const tamper = expectExit("implement stops when the agent edits the spec", dir, ["implement", "FEAT-001", "--agent", agent, "--skip-baseline", "--runtime", "local"], 4, { ...env, AGENT_MODE: "tamper" });
  if (tamper.includes("INTEGRITY VIOLATION")) ok("it reports an integrity violation");
  else bad("tampering was not reported");
  writeFileSync(join(specPath, "prd.md"), SLUG_PRD);
  const asked = expectExit("implement stops and shows the agent's questions", dir, ["implement", "FEAT-001", "--agent", agent, "--skip-baseline", "--runtime", "local"], 2, { ...env, AGENT_MODE: "ask" });
  if (asked.includes("underscores")) ok("the agent's question reaches the user");
  else bad("the agent's question was not shown");

  // the real thing
  const commitsBefore = headCount();
  expectExit("implement: baseline, agent, dependency install, verify", dir, ["implement", "FEAT-001", "--agent", agent, "--runtime", "local"], 0, env);
  const results = JSON.parse(readFileSync(join(dir, ".ai/evidence/latest/results.json"), "utf8")) as Json;
  const slugChecks = (results.items as Json[]).filter((i) => String(i.id).startsWith("FEAT-001:CHK"));
  if (results.passed === true && slugChecks.length === 3 && slugChecks.every((i) => i.status === "pass")) {
    ok("all three FEAT-001 checks passed against the running service");
  } else bad(`FEAT-001 checks did not all pass: ${JSON.stringify(slugChecks.map((i) => [i.id, i.status]))}`);
  if (run(join(dir, cfg.layout.backendDir, ".venv/bin/python"), ["-c", "import slugify"], dir).status === 0) ok("the agent's new dependency is installed");
  else bad("python-slugify is not installed");
  if (readFileSync(pyproject, "utf8").includes("python-slugify")) ok("and it is declared in the manifest");
  else bad("python-slugify is not in pyproject.toml");
  if (headCount() === commitsBefore) ok("nothing was committed: the human reviews the diff");
  else bad("implement made commits");
  expectExit("sync after implement has nothing left to do", dir, ["sync"], 0);

  // already built: an agent that has nothing to write must not be reported as having implemented anything
  git("add", "-A");
  git("commit", "-qm", "feat: slug endpoint");
  const noop = expectExit("implement a feature that is already built", dir, ["implement", "FEAT-001", "--agent", agent, "--skip-baseline", "--runtime", "local"], 0, { ...env, AGENT_MODE: "noop" });
  if (noop.includes("changed no file") && !noop.includes("is implemented and verified")) ok("it says nothing changed instead of claiming an implementation");
  else bad("a run that changed no file was reported as implemented");
}

// ---------------------------------------------------------------------------------------------
// `sdlc spec`: a requirements document (PDF / DOCX) in, a validated DRAFT spec out. A scripted
// agent stands in for the AI, so everything around it is exercised: text extraction, the prompt,
// the guard against stray edits, questions, validation with a fix-and-retry, and the overwrite guard.
// ---------------------------------------------------------------------------------------------

const DOC_LINES = [
  "Product Requirements: URL Slug Service",
  "1. Overview",
  "The service turns free text into a URL-friendly slug so that marketing can publish readable links.",
  "2. Functional requirements",
  'FR-1 GET /api/v1/slug?text=Hello World returns status 200 and the body {"slug": "hello-world"}.',
  "FR-2 The text Creme Brulee, written with accents, becomes creme-brulee.",
  "FR-3 A request without the text parameter returns status 422.",
  "FR-4 The text parameter is at most 200 characters long.",
  "3. Out of scope",
  "Custom separators, uniqueness checks and persistence of slugs.",
];

/** A minimal valid one-page PDF (uncompressed text) with a correct cross-reference table. */
function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = ["BT", "/F1 10 Tf", "14 TL", "40 800 Td", ...lines.flatMap((l) => [`(${esc(l)}) Tj`, "T*"]), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** A minimal valid .docx (a zip with the three required parts). */
function makeDocx(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join("");
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    "[Content_Types].xml": strToU8(
      `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(`${xml}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  });
}

/** A scripted "spec writer": reads the prompt on stdin and drafts the two spec files. */
const SPEC_AGENT = `import os, pathlib, re, sys

prompt = sys.stdin.read()
mode = os.environ.get("AGENT_MODE", "ok")
fix = pathlib.Path(os.environ["SPEC_FIXTURES"])
root = pathlib.Path.cwd()
is_fix_round = "fix the draft specification" in prompt

if not is_fix_round:  # the whole point of \`spec\`: the document must have reached the agent
    for needle in ("FR-1", "hello-world", "(Source:", "\`backend\`"):
        if needle not in prompt:
            print("the prompt is missing: " + needle)
            sys.exit(3)

found = re.search(r"\`([^\`]*specs/(FEAT-\\d+)-[^\`/]+)/", prompt)
spec_dir, feature = root / found.group(1), found.group(2)
calls = fix / "calls.txt"
calls.write_text(calls.read_text() + "x" if calls.exists() else "x")

if mode == "stray":  # writes outside the spec folder: must be stopped
    (root / os.environ["BACKEND_DIR"] / "app" / "stray.py").write_text("print('out of scope')\\n")
    sys.exit(0)
if mode == "ask":  # nothing usable in the document: ask instead of inventing
    questions = re.search(r"\`([^\`]*QUESTIONS\\.md)\`", prompt)
    pathlib.Path(questions.group(1)).write_text("The document defines no password rules. Which hashing scheme should be used?\\n")
    sys.exit(0)

bad_first = mode == "invalid-then-fix" and not is_fix_round
(spec_dir / "prd.md").write_text((fix / "prd.md").read_text().replace("FEAT-001", feature))
(spec_dir / "acceptance.json").write_text((fix / ("bad-acceptance.json" if bad_first else "acceptance.json")).read_text().replace("FEAT-001", feature))
print("drafted " + feature)
`;

function specFromDocument(dir: string, cfg: Json, git: (...a: string[]) => unknown, name: string): void {
  log("  -- sdlc spec --");
  const work = join(dir, "..", `spec-${name}`);
  mkdirSync(work, { recursive: true });
  const pdf = join(work, "requirements.pdf");
  const docx = join(work, "requirements.docx");
  writeFileSync(pdf, makePdf(DOC_LINES));
  writeFileSync(docx, makeDocx(DOC_LINES));
  writeFileSync(join(work, "notes.xyz"), "not a document");

  // what the scripted agent will "write": a valid draft, and an invalid first attempt (AC-002 uncovered, a target that does not exist)
  const prdDraft = `${SLUG_PRD}\n## 9. Assumptions & open questions\nASSUMPTION: slugs are lower-case.\n`;
  const badChecks = [slugChecks[0], { ...slugChecks[2], target: "nowhere" }];
  writeFileSync(join(work, "prd.md"), prdDraft);
  writeFileSync(join(work, "acceptance.json"), SLUG_ACCEPTANCE);
  writeFileSync(join(work, "bad-acceptance.json"), JSON.stringify({ feature: "FEAT-001", checks: badChecks }, null, 2));
  const agentFile = join(work, "spec-agent.py");
  writeFileSync(agentFile, SPEC_AGENT);
  const agent = `python3 ${agentFile}`;
  const env = { BACKEND_DIR: cfg.layout.backendDir, SPEC_FIXTURES: work };
  const specFolders = () => readdirSync(join(dir, ".ai/specs")).filter((d) => d.startsWith("FEAT-")).sort();
  const calls = () => (existsSync(join(work, "calls.txt")) ? readFileSync(join(work, "calls.txt"), "utf8").length : 0);

  git("add", "-A");
  git("commit", "-qm", "chore: clean tree before spec");
  const foldersBefore = specFolders();

  // inputs the tool must refuse before any agent runs
  expectExit("spec refuses a missing file", dir, ["spec", join(work, "nope.pdf"), "--agent", agent], 2, env);
  const odd = expectExit("spec refuses an unsupported file type", dir, ["spec", join(work, "notes.xyz"), "--agent", agent], 2, env);
  if (odd.includes("Unsupported")) ok("it lists the supported types");
  else bad("unsupported type was not explained");
  expectExit("spec reports an agent that is not installed", dir, ["spec", pdf, "--agent", "definitely-not-installed-agent-xyz"], 2, env);

  // dry runs: the document text must reach the prompt, and nothing is created
  for (const [label, file, extractor] of [["PDF", pdf, ""], ["DOCX", docx, "docx"]] as const) {
    const dry = expectExit(`spec --dry-run reads the ${label}`, dir, ["spec", file, "--agent", agent, "--dry-run", "--focus", "the slug endpoint only"], 0, env);
    const promptFile = (dry.match(/prompt\s+:\s+(\S+)/) ?? [])[1];
    const text = promptFile ? readFileSync(join(dir, promptFile), "utf8") : "";
    const ready = text.includes("FR-1") && text.includes("hello-world") && text.includes("Custom separators") && text.includes("the slug endpoint only") && !text.includes("{{");
    if (ready && (!extractor || text.includes(extractor))) ok(`the ${label} text, the focus and the rules are in the prompt, fully filled in`);
    else bad(`the ${label} prompt is missing the document text, the focus or has unfilled placeholders`);
  }
  // the same PDF with every real PDF tool hidden from PATH: the built-in extractor must still deliver the text
  const noPoppler = (process.env.PATH ?? "").split(":").filter((p) => !existsSync(join(p, "pdftotext")) && !existsSync(join(p, "mutool"))).join(":");
  const bare = expectExit("spec --dry-run reads the PDF with only the built-in extractor", dir, ["spec", pdf, "--agent", agent, "--dry-run"], 0, { ...env, PATH: noPoppler });
  const bareFile = (bare.match(/prompt\s+:\s+(\S+)/) ?? [])[1];
  const bareText = bareFile ? readFileSync(join(dir, bareFile), "utf8") : "";
  if (bareText.includes("FR-1") && bareText.includes("hello-world") && bareText.includes("built-in")) ok("the built-in extractor delivered the PDF text and says so");
  else bad("the built-in extractor did not deliver the PDF text");
  if (JSON.stringify(specFolders()) === JSON.stringify(foldersBefore)) ok("a dry run creates nothing");
  else bad("a dry run created a spec folder");

  // a dirty tree is refused so the agent's work stays reviewable
  writeFileSync(join(dir, "stray.txt"), "uncommitted\n");
  expectExit("spec refuses a dirty tree", dir, ["spec", pdf, "--agent", agent], 2, env);
  rmSync(join(dir, "stray.txt"));

  // the agent may write only the two spec files
  const strayRun = expectExit("spec stops when the agent writes outside the spec folder", dir, ["spec", pdf, "--name", "requirements", "--agent", agent, "--max-attempts", "1"], 4, { ...env, AGENT_MODE: "stray" });
  if (strayRun.includes("INTEGRITY VIOLATION")) ok("it reports the stray file");
  else bad("a stray file was not reported");
  rmSync(join(dir, cfg.layout.backendDir, "app", "stray.py"), { force: true });

  // nothing usable in the document: the agent asks instead of inventing
  const asked = expectExit("spec stops and shows the agent's question", dir, ["spec", pdf, "--name", "requirements", "--agent", agent], 2, { ...env, AGENT_MODE: "ask" });
  if (asked.includes("hashing scheme")) ok("the question reaches the user");
  else bad("the question was not shown");

  // an invalid first draft: the tool validates, names the problems, the agent fixes them on attempt 2
  const callsBefore = calls();
  const draft = expectExit("spec validates the draft and gets it fixed", dir, ["spec", pdf, "--name", "requirements", "--agent", agent], 0, { ...env, AGENT_MODE: "invalid-then-fix" });
  if (draft.includes("AC-002 has no check") && draft.includes("'nowhere'") && draft.includes("attempt 2/3")) ok("the problems were named and a second attempt ran");
  else bad("the invalid draft was not reported and retried");
  if (calls() - callsBefore === 2) ok("the agent was called exactly twice");
  else bad(`expected 2 agent calls, saw ${calls() - callsBefore}`);
  if (draft.includes("3 acceptance criteria") && draft.includes("1 assumption") && draft.includes("DRAFT")) ok("the summary counts criteria and assumptions and says it is a draft to review");
  else bad("the summary is missing the criteria count, the assumption count or the review reminder");

  const created = specFolders().filter((f) => !foldersBefore.includes(f));
  const draftDir = created[0] ? join(dir, ".ai/specs", created[0]) : "";
  if (created.length === 1 && existsSync(join(draftDir, "source", "requirements.pdf"))) ok(`the spec folder ${created[0]} holds the source document`);
  else bad(`expected one new spec folder with source/requirements.pdf, got ${JSON.stringify(created)}`);
  const facts = expectExit("the drafted spec passes traceability", dir, ["facts", "--runtime", "none", "--feature", created[0]?.split("-").slice(0, 2).join("-") ?? "?"], 0);
  if (facts.includes("traceability") && !facts.includes("FAIL")) ok("every drafted criterion has a check");
  else bad("the drafted spec failed validation");

  // never overwrite a finished spec
  const again = expectExit("spec will not overwrite a finished PRD", dir, ["spec", pdf, "--name", "requirements", "--agent", agent], 2, env);
  if (again.includes("already has a finished PRD")) ok("it says why and how to proceed");
  else bad("overwrite refusal was not explained");

  // the chain: the draft is a normal spec that `implement` accepts (dry run: nothing is rebuilt)
  const feature = created[0]?.split("-").slice(0, 2).join("-") ?? "?";
  git("add", "-A");
  git("commit", "-qm", "chore: reviewed draft spec");
  const impl = expectExit("implement accepts the drafted spec", dir, ["implement", feature, "--agent", agent, "--dry-run"], 0, env);
  if (impl.includes("spec ok: 3 acceptance criteria")) ok("document to spec to implement works as one chain");
  else bad("implement did not accept the drafted spec");
}

const selected = values.scenario === "all" ? Object.keys(SCENARIOS) : [values.scenario as string];
for (const name of selected) {
  const patch = SCENARIOS[name];
  if (!patch) {
    console.error(`unknown scenario "${name}" (have: ${Object.keys(SCENARIOS).join(", ")})`);
    process.exit(64);
  }
  scenario(name, patch);
}

log(failures === 0 ? "\nE2E PASSED" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
