/**
 * End-to-end proof that what Scaffolder generates actually works.
 *
 * For each scenario it generates a project, installs it, runs every gate, runs the facts against
 * real processes, then exercises the healing loop (heal, no-progress, integrity, human hand-off).
 *
 *   npm run e2e                       # all scenarios
 *   npm run e2e -- --scenario default --keep
 *
 * Needs: python3 >= the scenario's backend version on PATH, node >= 22, network (pip/npm).
 */
import { spawn, spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { deepMerge, defaultConfig } from "../src/engine/config";
import { generateProject } from "../src/engine/generate";

type Json = Record<string, any>;

const SCENARIOS: Record<string, Json> = {
  default: {},
  "backend-only-no-db": { web: { enabled: false }, database: { type: "none" } },
  "custom-dirs": { layout: { backendDir: "services/api", webDir: "apps/web" } },
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
  } finally {
    if (values.keep) log(`  kept: ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
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
