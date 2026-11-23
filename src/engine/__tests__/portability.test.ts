import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, deepMerge } from "../config";
import { generateProject } from "../generate";

type Json = Record<string, any>;

const project = (patch: Json = {}) => generateProject(deepMerge(defaultConfig(), patch));
const fileOf = (patch: Json, path: string) => project(patch).files.find((f) => f.path === path);
const sdlcJson = (patch: Json = {}) => JSON.parse(fileOf(patch, ".ai/sdlc.json")!.content) as Json;
const sdlcPy = () => fileOf({}, "scripts/sdlc.py")!.content;

describe("generated project runs on macOS, Linux and Windows: what is generated", () => {
  it("ships a Windows launcher with CRLF line endings next to the bash launcher", () => {
    const cmd = fileOf({}, "scripts/sdlc.cmd")!;
    expect(cmd, "scripts/sdlc.cmd is not generated").toBeDefined();
    expect(cmd.content).toContain("\r\n");
    expect(cmd.content, "a bare LF in a batch file").not.toMatch(/(?<!\r)\n/);
    expect(cmd.content).toContain("sdlc.py");
    expect(cmd.content).toContain("py -3");
    expect(cmd.executable).toBe(false);
    expect(fileOf({}, "scripts/sdlc")!.executable).toBe(true);
  });

  it("the bash launcher tries python3, python and the py launcher, and checks that the candidate runs", () => {
    const bash = fileOf({}, "scripts/sdlc")!.content;
    expect(bash).toContain('for candidate in python3 python "py -3"');
    expect(bash).toContain("sys.version_info >= (3, 9)");
    expect(bash).toContain("exit 127");
  });

  it(".gitattributes keeps LF line endings (so shell scripts survive Windows checkouts) except for batch files", () => {
    const attributes = fileOf({}, ".gitattributes")!.content;
    expect(attributes).toContain("* text=auto eol=lf");
    expect(attributes).toContain("*.cmd text eol=crlf");
  });

  it("setup commands in sdlc.json are plain, OS-neutral strings (no sh-only syntax, no hard-coded venv path)", () => {
    for (const patch of [{}, { layout: { backendDir: "services/api", webDir: "apps/web" } }]) {
      const setup = sdlcJson(patch).setup as Json[];
      expect(setup.length).toBeGreaterThan(1);
      for (const step of setup) {
        for (const cmd of [step.cmd, step.fallbackCmd].filter(Boolean) as string[]) {
          expect(cmd, step.id).not.toMatch(/\.venv\/bin/);
          expect(cmd, step.id).not.toMatch(/\bif \[|\bfi\b|;|\$\(|`/);
        }
      }
      const py = setup.find((s) => s.id === "backend.install")!;
      expect(py.cmd).toMatch(/^\{python\} -m venv --clear \.venv && \{venv_python\} -m pip install/);
      expect(py.cmd).not.toContain(".venv/bin");
      const web = setup.find((s) => s.id === "web.install")!;
      expect(web.cmd).toBe("npm ci --no-audit --no-fund");
      expect(web.lockfile).toBe("package-lock.json");
      expect(web.fallbackCmd).toBe("npm install --no-audit --no-fund");
    }
  });

  it("puts the venv on PATH for both layouts: bin (macOS/Linux) and Scripts (Windows)", () => {
    const cfg = sdlcJson({ layout: { backendDir: "services/api" } });
    const gate = (cfg.gates as Json[]).find((g) => g.id === "backend.lint")!;
    expect(gate.pathPrepend).toEqual(["services/api/.venv/bin", "services/api/.venv/Scripts"]);
    const backend = (cfg.runtime.local.services as Json[]).find((s) => s.name === "backend")!;
    expect(backend.pathPrepend).toEqual(["services/api/.venv/bin", "services/api/.venv/Scripts"]);
  });

  it("CI keeps the bash forms (it runs on Linux), so local and CI still run the same gates", () => {
    const ci = fileOf({}, ".github/workflows/ci.yml")!.content;
    expect(ci).toContain("python3 -m venv --clear .venv");
    expect(ci).toContain("if [ -f package-lock.json ]");
    expect(ci).not.toContain("{venv_python}");
  });

  it("protects the Windows launcher from the agent like the other entry points", () => {
    const integrity = sdlcJson().integrity as Json;
    expect(integrity.protected).toContain("scripts/sdlc.cmd");
  });
});

describe("generated scripts/sdlc.py: rules that keep it portable (it cannot be run on every OS here)", () => {
  const source = sdlcPy();
  const lines = source.split("\n");

  it("never reads or writes text without saying UTF-8 (Windows defaults to a legacy code page)", () => {
    const offenders = lines.filter((l) => /\.(read_text|write_text)\(/.test(l) && !l.includes("encoding="));
    expect(offenders).toEqual([]);
    expect(lines.filter((l) => /\btext=True\b/.test(l))).toEqual([]);
    expect(lines.filter((l) => /\bopen\(/.test(l) && !/urlopen/.test(l) && !l.includes("encoding=") && !/\b(rb|wb|"rb"|"wb")\b/.test(l))).toEqual([]);
  });

  it("only signals process groups on POSIX, after the Windows branch has returned", () => {
    const body = /def kill_group[\s\S]*?\n\n\n/.exec(source)![0];
    expect(body).toContain("taskkill");
    expect(body.indexOf("return")).toBeGreaterThan(-1);
    const expected: Record<string, number> = { "os.killpg": 3, "os.getpgid": 1, "signal.SIGKILL": 1 }; // TERM, "is the group gone?", KILL
    for (const [posixOnly, count] of Object.entries(expected)) {
      expect(source.split(posixOnly).length - 1, `${posixOnly} used outside kill_group`).toBe(count);
      expect(body.indexOf(posixOnly), `${posixOnly} before the Windows return`).toBeGreaterThan(body.indexOf("return"));
    }
    expect(source.split("start_new_session").length - 1, "start_new_session outside GROUP_KWARGS").toBe(1);
  });

  it("quotes and splits shell commands through helpers that know the OS", () => {
    expect(source.split("shlex.quote(").length - 1).toBe(1);
    expect(source.split("shlex.split(").length - 1).toBe(1);
    expect(source).toContain("subprocess.list2cmdline");
    expect(source).toContain('rf"{name}\\Scripts\\python.exe" if IS_WINDOWS else f"{name}/bin/python"');
  });

  it("does not require `python3` on PATH (on Windows it is usually the Microsoft Store stub)", () => {
    expect(source).not.toMatch(/needed = \{[^}]*python3/);
    expect(source).toContain("windows_launcher_pythons");
    expect(source).toContain("sys.executable");
  });

  it("normalises relative paths to forward slashes, which the config and git use on every OS", () => {
    expect(/def rel\([\s\S]*?\n\n/.exec(source)![0]).toContain("as_posix()");
  });
});

/**
 * The Windows branches cannot be executed on a Mac or Linux machine, so these tests run the real functions
 * with `IS_WINDOWS` switched on and fake `taskkill`, `py`, `winget` and Git installations on PATH. They prove the
 * logic (quoting, arguments, discovery order); they do not prove that Windows itself behaves as assumed.
 * The `platforms` CI job runs the real thing on windows-latest.
 */
describe.skipIf(process.platform === "win32")("Windows branches of scripts/sdlc.py, simulated", () => {
  const SIMULATION = `
import os, pathlib, subprocess, sys, tempfile, importlib.util
spec = importlib.util.spec_from_file_location("sdlc", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
bindir, gitroot, fakepy = sys.argv[2], sys.argv[3], sys.argv[4]
original_path = os.environ["PATH"]
failures = []

def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(detail)))
    if not cond:
        failures.append(name)

# --- without IS_WINDOWS the Windows-only helpers do nothing
check("py launcher is ignored off Windows", m.windows_launcher_pythons((3, 12)) == [])
check("posix quoting", m.quote_arg("/opt/my python/bin/python") == "'/opt/my python/bin/python'")

m.IS_WINDOWS = True
# --- quoting for cmd.exe
check("quote_arg quotes a path with spaces", m.quote_arg(r"C:\\Program Files\\Python312\\python.exe") == '"C:\\\\Program Files\\\\Python312\\\\python.exe"', m.quote_arg(r"C:\\Program Files\\Python312\\python.exe"))
check("quote_arg leaves a simple path alone", m.quote_arg(r"C:\\Python312\\python.exe") == r"C:\\Python312\\python.exe")
check("command_program removes quotes", m.command_program(r'"C:\\Program Files\\agent\\agent.exe" --flag') == r"C:\\Program Files\\agent\\agent.exe", m.command_program(r'"C:\\Program Files\\agent\\agent.exe" --flag'))
check("command_program, plain command", m.command_program('claude -p --allowedTools "Read" "Edit"') == "claude")
check("agent_problem names a missing program", "nonexistent-agent-xyz" in (m.agent_problem('"nonexistent-agent-xyz" --x') or ""))

# --- python3 in a command means the interpreter running this tool
adapted = m.adapt_command("python3 scripts/sdlc.py secrets")
check("adapt_command swaps python3 for this interpreter", adapted.startswith(m.quote_arg(sys.executable) + " scripts/sdlc.py"), adapted)
check("adapt_command leaves other commands alone", m.adapt_command("pytest -q") == "pytest -q" and m.adapt_command("python3.12 -V") == "python3.12 -V")

# --- setup commands
m.VENV_PYTHON = r".venv\\Scripts\\python.exe"
root = pathlib.Path(tempfile.mkdtemp()); (root / "web").mkdir(); m.ROOT = root
py_step = {"cwd": "backend", "cmd": '{python} -m venv --clear .venv && {venv_python} -m pip install --quiet -e ".[dev]"'}
cmd = m.setup_command(py_step, r"C:\\Program Files\\Python312\\python.exe")
check("setup command: spaces quoted, venv path is the Windows one",
      cmd == '"C:\\\\Program Files\\\\Python312\\\\python.exe" -m venv --clear .venv && .venv\\\\Scripts\\\\python.exe -m pip install --quiet -e ".[dev]"', cmd)
# an adopted project may keep its environment under another name (venv/, env/): {venv_python} follows the step's own folder
adopted = {"cwd": "api", "venv": "venv", "cmd": "{venv_python} -m pip install --quiet -r requirements.txt"}
check("setup command: an existing venv named venv/ gets the Windows interpreter path", m.setup_command(adopted, None) == "venv\\Scripts\\python.exe -m pip install --quiet -r requirements.txt", m.setup_command(adopted, None))
web = {"cwd": "web", "cmd": "npm ci", "lockfile": "package-lock.json", "fallbackCmd": "npm install"}
check("no lockfile: npm install", m.setup_command(web, None) == "npm install")
(root / "web" / "package-lock.json").write_text("{}")
check("lockfile: npm ci", m.setup_command(web, None) == "npm ci")

# --- a spec that names .venv/bin also finds .venv/Scripts (the failure seen on windows-latest: pytest not found)
check("venv_alternatives: bin -> Scripts", m.venv_alternatives("backend/.venv/bin") == ["backend/.venv/bin", "backend/.venv/Scripts"], m.venv_alternatives("backend/.venv/bin"))
check("venv_alternatives: Scripts -> bin", m.venv_alternatives("services/api/.venv/Scripts") == ["services/api/.venv/Scripts", "services/api/.venv/bin"])
check("venv_alternatives: other paths untouched", m.venv_alternatives("tools/bin") == ["tools/bin"])
(root / "backend" / ".venv" / "Scripts").mkdir(parents=True)
only_scripts = m.build_env(None, ["backend/.venv/bin"])["PATH"].split(os.pathsep)
check("a .venv/bin entry puts the existing .venv/Scripts on PATH", str(root / "backend" / ".venv" / "Scripts") in only_scripts, only_scripts[:2])
check("a directory that does not exist is not added", str(root / "backend" / ".venv" / "bin") not in only_scripts)

# --- install hints list this OS first
check("hints start with winget on Windows", "winget install -e --id Python.Python.3.12" in m.install_hints("3.12")[0], m.install_hints("3.12")[0])
check("hints end with the PowerShell way to point at a Python", "SDLC_PYTHON" in m.install_hints("3.12")[-1] and "sdlc.cmd" in m.install_hints("3.12")[-1])

# --- the py launcher
os.environ["PATH"] = bindir + os.pathsep + original_path
check("py launcher finds the interpreter it reports", m.windows_launcher_pythons((3, 12)) == [fakepy], m.windows_launcher_pythons((3, 12)))

# --- stopping a process tree: taskkill /PID <pid> /T /F
proc = subprocess.Popen(["sleep", "30"])
m.kill_group(proc)
recorded = pathlib.Path(bindir, "taskkill.log").read_text().split()
check("kill_group ends the whole tree with taskkill", recorded == ["/PID", str(proc.pid), "/T", "/F"], recorded)
check("the process is gone", proc.poll() is not None)
if proc.poll() is None:
    proc.kill()

# --- Git for Windows' bash, not WSL's
os.environ["PATH"] = gitroot + os.sep + "cmd"
check("find_git_bash locates <Git>/bin/bash.exe", (m.find_git_bash() or "").endswith("Git/bin/bash.exe"), m.find_git_bash())
os.environ["PATH"] = bindir
check("find_git_bash is None without Git", m.find_git_bash() is None)

# --- offering Python with winget (explicit consent only, and uv/brew are not installed here)
os.environ["PATH"] = bindir
os.environ["SDLC_INSTALL_PYTHON"] = "yes"
found = m.offer_python_install("3.12")
winget_args = pathlib.Path(bindir, "winget.log").read_text().split()
check("winget is asked for Python.Python.3.12 non-interactively",
      winget_args == ["install", "-e", "--id", "Python.Python.3.12", "--accept-package-agreements", "--accept-source-agreements"], winget_args)
check("the interpreter winget installed is found through py", found == fakepy, found)

print("RESULT", "FAILED: " + ", ".join(failures) if failures else "all passed")
sys.exit(1 if failures else 0)
`;

  it("quoting, discovery, taskkill, Git bash and winget behave as designed", () => {
    const dir = mkdtempSync(join(tmpdir(), "scaffolder-winsim-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const exe = (path: string, body: string) => {
        writeFileSync(path, `#!/bin/sh\n${body}\n`);
        chmodSync(path, 0o755);
      };
      exe(join(bin, "taskkill"), `echo "$@" > "${bin}/taskkill.log"\nkill "$2"`);
      const fakePython = join(dir, "python3.12");
      exe(fakePython, "echo 3.12"); // answers `-c ...` with its version, as a real interpreter would
      exe(join(bin, "py"), `if [ "$1" = "-3.12" ]; then echo "${fakePython}"; exit 0; fi\nexit 1`);
      exe(join(bin, "winget"), `echo "$@" > "${bin}/winget.log"`);
      const git = join(dir, "Git");
      mkdirSync(join(git, "cmd"), { recursive: true });
      mkdirSync(join(git, "bin"), { recursive: true });
      exe(join(git, "cmd", "git"), "exit 0");
      writeFileSync(join(git, "bin", "bash.exe"), "");
      const script = join(dir, "simulation.py");
      writeFileSync(script, SIMULATION);
      const sdlc = join(dir, "sdlc.py");
      writeFileSync(sdlc, sdlcPy());
      const run = spawnSync("python3", ["-I", script, sdlc, bin, git, fakePython], { encoding: "utf8" });
      if (run.error) return; // python3 not installed: nothing to simulate with
      expect(`${run.stdout}${run.stderr}`, "simulation output").toContain("RESULT all passed");
      expect(run.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the simulation fixture is not stale (the functions it exercises still exist)", () => {
    const source = sdlcPy();
    for (const name of ["quote_arg", "command_program", "adapt_command", "setup_command", "windows_launcher_pythons", "find_git_bash", "kill_group", "offer_python_install", "install_hints"]) {
      expect(source, name).toContain(`def ${name}(`);
    }
  });
});

/**
 * Regression test for a failure seen on a CI runner: the shell exited at once, but the server it started was still
 * shutting down (holding its port) when `kill_group` returned. It must wait for the WHOLE group, and kill what
 * ignores SIGTERM. Needs a POSIX shell, so Windows (taskkill /T) is covered by the simulated test above.
 */
describe.skipIf(process.platform === "win32")("kill_group waits for the whole process group (POSIX)", () => {
  const PROBE = `
import importlib.util, os, subprocess, sys, tempfile, time
spec = importlib.util.spec_from_file_location("sdlc", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tmp = tempfile.mkdtemp()
failures = []

def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False

def scenario(name, child_body):
    child = os.path.join(tmp, name + ".py")
    pidfile = os.path.join(tmp, name + ".pid")
    open(child, "w").write("import os, signal, sys, time\\nopen(sys.argv[1], 'w').write(str(os.getpid()))\\n" + child_body)
    # "; true" keeps the shell as the parent of the child, like \`sh -c 'uvicorn ...'\` in a real run
    proc = subprocess.Popen(sys.executable + " " + child + " " + pidfile + "; true", shell=True, **m.GROUP_KWARGS)
    for _ in range(100):
        if os.path.exists(pidfile) and open(pidfile).read():
            break
        time.sleep(0.05)
    pid = int(open(pidfile).read())
    started = time.time()
    m.kill_group(proc)
    took = time.time() - started
    gone = not alive(pid)
    print(("ok   " if gone else "FAIL ") + name + ": child gone when kill_group returned" + ("" if gone else " (STILL RUNNING)") + " after %.1fs" % took)
    if not gone:
        failures.append(name)
        os.kill(pid, 9)

# shuts down gracefully, but takes a moment (like uvicorn closing connections)
scenario("graceful", "def bye(*a):\\n    time.sleep(1.5)\\n    sys.exit(0)\\nsignal.signal(signal.SIGTERM, bye)\\ntime.sleep(60)\\n")
# ignores SIGTERM entirely: must be killed
scenario("stubborn", "signal.signal(signal.SIGTERM, signal.SIG_IGN)\\ntime.sleep(60)\\n")
print("RESULT", "FAILED: " + ", ".join(failures) if failures else "all passed")
sys.exit(1 if failures else 0)
`;

  it("returns only when the server the shell started is gone, and kills one that ignores SIGTERM", () => {
    const dir = mkdtempSync(join(tmpdir(), "scaffolder-killgroup-"));
    try {
      const sdlc = join(dir, "sdlc.py");
      writeFileSync(sdlc, sdlcPy());
      const probe = join(dir, "probe.py");
      writeFileSync(probe, PROBE);
      const run = spawnSync("python3", ["-I", probe, sdlc], { encoding: "utf8", timeout: 60_000 });
      if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") return; // no python3
      expect(`${run.stdout}${run.stderr}`).toContain("RESULT all passed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
