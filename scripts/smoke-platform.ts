/**
 * Cross-platform smoke test: does a generated project work on THIS operating system?
 *
 *   npm run smoke               # macOS, Linux or Windows
 *   npm run smoke -- --keep     # keep the generated project for inspection
 *
 * It generates a project and drives it through the launcher a person on this OS would type
 * (`./scripts/sdlc` on macOS/Linux, `scripts\sdlc.cmd` on Windows): doctor, setup (pip + npm), every gate,
 * and the PRD facts against real local processes. Unlike `npm run e2e` it needs no bash, no Docker and no
 * fake tools, so CI runs it on windows-latest and macos-latest as well as ubuntu.
 *
 * Needs: Python >= 3.12, Node >= 22, git, network (pip/npm).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { deepMerge, defaultConfig } from "../src/engine/config";
import { generateProject } from "../src/engine/generate";

const { values } = parseArgs({ options: { keep: { type: "boolean", default: false } } });
const WINDOWS = process.platform === "win32";
const BACKEND_PORT = 18080;
const WEB_PORT = 13080;

let failures = 0;
const log = (msg: string) => console.log(msg);
const pass = (msg: string) => log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  failures++;
  log(`  ✗ ${msg}`);
};

function sdlc(dir: string, args: string[], extraEnv: Record<string, string> = {}) {
  const env = { ...process.env, ...extraEnv };
  const r = WINDOWS
    ? spawnSync(`scripts\\sdlc.cmd ${args.join(" ")}`, { cwd: dir, env, encoding: "utf8", shell: true })
    : spawnSync("./scripts/sdlc", args, { cwd: dir, env, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n[could not start: ${r.error.message}]` : ""}` };
}

function expectExit(dir: string, label: string, args: string[], want = 0) {
  const r = sdlc(dir, args);
  if (r.status === want) pass(`${label} (exit ${want})`);
  else {
    fail(`${label}: expected exit ${want}, got ${r.status}`);
    log(r.out.split("\n").slice(-40).map((l) => `      ${l}`).join("\n"));
  }
  return r.out;
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => (socket.destroy(), resolve(false)));
    socket.once("error", () => resolve(true));
    socket.setTimeout(2000, () => (socket.destroy(), resolve(true)));
  });
}

async function main() {
  log(`\n=== smoke test on ${process.platform} (node ${process.version}) ===`);
  const cfg = deepMerge(defaultConfig(), {
    backend: { port: BACKEND_PORT },
    web: { port: WEB_PORT },
    sdlc: { runtime: "local" }, // Windows runners cannot run Linux containers; local processes work everywhere
  });
  const result = generateProject(cfg);
  if (result.issues.some((i) => i.level === "error")) return fail(`config invalid: ${JSON.stringify(result.issues)}`);

  const dir = mkdtempSync(join(tmpdir(), "scaffolder-smoke-"));
  try {
    for (const f of result.files) {
      const full = join(dir, f.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.content);
      if (f.executable && !WINDOWS) chmodSync(full, 0o755); // what unzipping or `scaffold generate` does
    }
    pass(`generated ${result.files.length} files in ${dir}`);
    spawnSync("git", ["init", "-q"], { cwd: dir });

    // 1. the launcher itself, and what the toolchain check says about this machine
    const doctor = expectExit(dir, "doctor", ["doctor"]);
    log(doctor.split("\n").map((l) => `      ${l}`).join("\n"));
    if (/toolchain ready/.test(doctor)) pass("doctor says the toolchain is ready");
    else fail("doctor did not say the toolchain is ready");

    // 2. install: creates a venv (OS-specific path) and runs npm
    expectExit(dir, "setup (pip + npm install)", ["setup"]);
    const venvPython = WINDOWS ? "backend/.venv/Scripts/python.exe" : "backend/.venv/bin/python";
    if (existsSync(join(dir, venvPython))) pass(`virtual environment created (${venvPython})`);
    else fail(`virtual environment missing: ${venvPython}`);
    const again = expectExit(dir, "sync after setup finds nothing to install", ["sync"]);
    if (/up to date|nothing to install|already/i.test(again)) pass("sync recognises the installed state");
    else fail("sync did not report an up-to-date install");

    // 3. every gate: lint, types, unit + coverage, build, contract, security
    expectExit(dir, "gates: lint, types, unit+coverage, build, contract, security", ["gates", "--keep-going"]);

    // 4. facts against real processes. The second run proves the first run's servers were stopped:
    //    a server left behind would still hold the port and the run would refuse to start.
    expectExit(dir, "facts against real local processes", ["facts", "--runtime", "local"]);
    const resultsFile = join(dir, ".ai/evidence/latest/results.json");
    if (existsSync(resultsFile) && JSON.parse(readFileSync(resultsFile, "utf8")).passed === true) pass("evidence results.json says passed");
    else fail("evidence results.json does not say passed");
    for (const [name, port] of [["backend", BACKEND_PORT], ["web", WEB_PORT]] as const) {
      if (await portIsFree(port)) pass(`${name} server was stopped (port ${port} is free)`);
      else fail(`${name} server is still running on port ${port}: the process tree was not stopped`);
    }
    expectExit(dir, "facts again (needs the ports to be free)", ["facts", "--runtime", "local"]);

    // 5. a spec with non-ASCII text, as a PDF-derived PRD would have: must be read as UTF-8 on every OS
    expectExit(dir, "new feature spec", ["new", "unicode-check"]);
    const specDir = join(dir, ".ai/specs/FEAT-001-unicode-check");
    writeFileSync(join(specDir, "prd.md"), "# FEAT-001 Café ✓\n\n## Acceptance criteria\n\n- **AC-100** Given a café — when the API is asked, then it answers ✓\n", "utf8");
    writeFileSync(
      join(specDir, "acceptance.json"),
      JSON.stringify({ feature: "FEAT-001", checks: [{ id: "CHK-100", name: "Liveness answers (café ✓)", covers: ["AC-100"], type: "http", target: "backend", path: "/health", expect: { status: 200 } }] }, null, 2),
      "utf8",
    );
    expectExit(dir, "facts read a spec containing é — ✓", ["facts", "--runtime", "local", "--feature", "FEAT-001"]);
    const report = join(dir, ".ai/evidence/latest/report.md");
    if (existsSync(report) && readFileSync(report, "utf8").includes("café")) pass("the report keeps the non-ASCII text intact");
    else fail("the report lost or garbled the non-ASCII text");
  } finally {
    if (values.keep) log(`\nkept: ${dir}`);
    else rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

main()
  .catch((error) => fail(`unexpected error: ${error instanceof Error ? error.stack : String(error)}`))
  .finally(() => {
    log(failures === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED: ${failures} problem(s)`);
    process.exit(failures === 0 ? 0 : 1);
  });
