import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_PRESETS, DESKTOP_APPS, HANDOFF_PREFIX } from "../capabilities";
import { defaultConfig, deepMerge, hasErrors, validateConfig } from "../config";
import { generateProject } from "../generate";

type Json = Record<string, any>;

const sdlcJson = (patch: Json = {}) =>
  JSON.parse(generateProject(deepMerge(defaultConfig(), patch)).files.find((f) => f.path === ".ai/sdlc.json")!.content) as Json;

describe("desktop applications: what is generated", () => {
  it("the Claude desktop engine is the same Claude Code command as `claude`, started from where the app keeps it", () => {
    const claude = AGENT_PRESETS.find((p) => p.id === "claude")!;
    const engine = AGENT_PRESETS.find((p) => p.id === "claude-desktop")!;
    expect(engine.command.replace("{claude_desktop}", "claude")).toBe(claude.command);
    expect(engine.program).toBe("{claude_desktop}");
    expect(engine.mode).toBe("headless");
  });

  it("every desktop app can be opened on macOS, Windows and Linux, and says how to find it, install it and use it", () => {
    expect(DESKTOP_APPS.map((a) => a.id)).toEqual(["claude", "cursor", "vscode"]);
    for (const app of DESKTOP_APPS) {
      for (const os of ["macos", "windows", "linux"] as const) {
        expect(app.open[os].length, `${app.id} on ${os}`).toBeGreaterThan(0);
        for (const argv of app.open[os]) {
          expect(argv[0], `${app.id} on ${os}`).toBeTruthy();
          // each launcher hands the app the folder or the instruction, or it would open nothing useful
          expect(argv.join(" "), `${app.id} on ${os}`).toMatch(/\{dir\}|\{query\}/);
        }
      }
      expect(app.detect.macos.length + app.detect.which.length, app.id).toBeGreaterThan(0);
      expect(app.steps, app.id).not.toBe("");
      expect(app.install, app.id).not.toBe("");
      expect(app.docs, app.id).toMatch(/^https:\/\//);
    }
  });

  it("the Claude desktop app is opened with its documented new-session link, carrying the instruction", () => {
    const claude = DESKTOP_APPS.find((a) => a.id === "claude")!;
    for (const os of ["macos", "windows", "linux"] as const) {
      expect(claude.open[os].flat().join(" "), os).toContain("claude://code/new?q={query}");
    }
  });

  it("sdlc.json carries the desktop apps and each agent's mode, in the file the agent may not edit", () => {
    const cfg = sdlcJson();
    expect(cfg.agent.desktopApps.map((a: Json) => a.id)).toEqual(DESKTOP_APPS.map((a) => a.id));
    for (const app of cfg.agent.desktopApps) expect(Object.keys(app).sort(), app.id).toEqual(["detect", "docs", "id", "install", "label", "open", "steps"]);
    const modes = Object.fromEntries(cfg.agent.presets.map((p: Json) => [p.id, p.mode]));
    expect(modes).toMatchObject({ claude: "headless", "claude-desktop": "headless", "handoff-claude": "handoff", "handoff-cursor": "handoff", "handoff-vscode": "handoff" });
    for (const p of cfg.agent.presets.filter((x: Json) => x.mode === "handoff")) {
      expect(DESKTOP_APPS.map((a) => a.id), p.id).toContain(p.command.slice(HANDOFF_PREFIX.length));
    }
    expect(cfg.integrity.protected).toContain(".ai/sdlc.json");
  });

  it("a project can default to a desktop app, and an explicit command still wins", () => {
    for (const preset of ["claude-desktop", "handoff-claude", "handoff-cursor", "handoff-vscode"]) {
      const patch = { sdlc: { agent: { preset } } };
      expect(hasErrors(validateConfig(deepMerge(defaultConfig(), patch))), preset).toBe(false);
      expect(sdlcJson(patch).agent.command, preset).toBe(AGENT_PRESETS.find((p) => p.id === preset)!.command);
    }
    expect(sdlcJson({ sdlc: { agent: { preset: "handoff-cursor", command: "my-agent" } } }).agent.command).toBe("my-agent");
  });

  it("the generated docs tell a person about the desktop options", () => {
    const files = generateProject(defaultConfig()).files;
    for (const path of ["README.md", "AGENTS.md", ".ai/README.md"]) {
      expect(files.find((f) => f.path === path)!.content, path).toMatch(/claude-desktop|desktop app/i);
    }
  });
});

/**
 * The tool in a real generated project, with fake programs for everything that is not ours: the Claude desktop app's Claude Code,
 * `open`, the clipboard and the editors. Their PATH holds only the fakes, so a test can never open a real app or touch the real
 * clipboard. POSIX only (the fakes are shell scripts); a hand-off waits for a person, so those tests run it in a pseudo-terminal.
 */
describe.skipIf(process.platform === "win32")("desktop applications: in a generated project", () => {
  let dir = "";
  let bin = "";
  let spaced = "";
  let python = "";
  let home = "";
  const opened = () => join(dir, "..", `opened-${process.pid}.log`);
  const clipboard = () => join(dir, "..", `clipboard-${process.pid}.txt`);

  const fake = (folder: string, name: string, body: string) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), `#!/bin/sh\n${body}`);
    chmodSync(join(folder, name), 0o755);
    return join(folder, name);
  };
  /** fakes for every way a hand-off can open an app or fill the clipboard, so it works the same on macOS and Linux */
  const desktopFakes = (folder: string, { clip = true, openCode = 0 } = {}) => {
    for (const launcher of ["open", "xdg-open", "cursor", "code"]) fake(folder, launcher, `printf '%s\\n' "$@" >> '${opened()}'\nexit ${openCode}\n`);
    if (clip) for (const tool of ["pbcopy", "wl-copy"]) fake(folder, tool, `IFS= read -r line || true\nprintf '%s' "$line" > '${clipboard()}'\n`);
  };
  const env = (extra: Record<string, string> = {}, path = bin) => ({ PATH: path, HOME: home, NO_COLOR: "1", ...extra }) as unknown as NodeJS.ProcessEnv;
  const sh = (command: string[], extra: Record<string, string> = {}, path = bin) =>
    spawnSync(python, ["-I", join(dir, "scripts", "sdlc.py"), ...command], { cwd: dir, encoding: "utf8", env: env(extra, path) });
  const out = (r: ReturnType<typeof sh>) => `${r.stdout}${r.stderr}`;
  const probe = (code: string, extra: Record<string, string> = {}) => {
    writeFileSync(join(dir, "probe.py"), `import importlib.util, json, os, sys\nspec = importlib.util.spec_from_file_location("sdlc", sys.argv[1])\nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n${code}\n`);
    const r = spawnSync(python, ["-I", join(dir, "probe.py"), join(dir, "scripts", "sdlc.py")], { cwd: dir, encoding: "utf8", env: env(extra) });
    expect(r.stderr, "the probe failed").toBe("");
    return JSON.parse(r.stdout.trim().split("\n").pop()!) as any;
  };

  /** Runs sdlc in a pseudo-terminal. At the hand-off's "Press Enter" it plays the person: writes a draft spec, presses Enter, or hangs up (Ctrl-D). */
  const DRIVER = `
import json, os, pty, select, sys, time
from pathlib import Path
mode, cwd, cmd = sys.argv[1], sys.argv[2], sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execv(cmd[0], cmd)
buf, sent, deadline = b"", False, time.time() + 90
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 1)
    if ready:
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        buf += data
    if not sent and b"Press Enter when the agent has finished" in buf:
        sent = True
        if mode == "draft":  # the person's agent drafts the spec: the worked example, under the new feature's id
            specs = Path(cwd) / ".ai" / "specs"
            target = next(specs.glob("FEAT-001-*"))
            for name in ("prd.md", "acceptance.json"):
                text = (next(specs.glob("FEAT-000-*")) / name).read_text(encoding="utf-8")
                (target / name).write_text(text.replace("FEAT-000", "FEAT-001"), encoding="utf-8")
        os.write(fd, b"\\x04" if mode == "eof" else b"\\n")
_, status = os.waitpid(pid, 0)
print(json.dumps({"code": os.waitstatus_to_exitcode(status), "sent": sent, "output": buf.decode("utf-8", "replace").replace("\\r", "")}))
`;
  const inTerminal = (mode: "draft" | "enter" | "eof", command: string[], path = bin) => {
    writeFileSync(join(dir, "driver.py"), DRIVER);
    const r = spawnSync(python, ["-I", join(dir, "driver.py"), mode, dir, python, "-I", join(dir, "scripts", "sdlc.py"), ...command], {
      cwd: dir, encoding: "utf8", env: env({}, path), timeout: 120000,
    });
    expect(r.stderr, "the terminal driver failed").toBe("");
    return JSON.parse(r.stdout.trim().split("\n").pop()!) as { code: number; sent: boolean; output: string };
  };
  const reset = () => {
    rmSync(opened(), { force: true });
    rmSync(clipboard(), { force: true });
    rmSync(join(dir, ".ai", "specs", "FEAT-001-requirements"), { recursive: true, force: true });
  };

  beforeAll(() => {
    const found = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
    python = (found.stdout || "").trim();
    dir = mkdtempSync(join(tmpdir(), "scaffolder-desktop-"));
    bin = join(dir, "..", `desktopbin-${process.pid}`);
    spaced = join(dir, "..", `Application Support-${process.pid}`);
    home = join(dir, "..", `home-${process.pid}`);
    mkdirSync(home, { recursive: true });
    desktopFakes(bin);
    for (const f of generateProject(defaultConfig()).files) {
      const full = join(dir, f.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.content);
    }
    writeFileSync(join(dir, "requirements.md"), "# Login\n\nA customer logs in with an email and a password and gets a token.\n");
  });

  afterAll(() => {
    for (const p of [dir, bin, spaced, home, `${dir}/../bin-broken-${process.pid}`, opened(), clipboard()]) rmSync(p, { recursive: true, force: true });
  });

  describe("the Claude desktop app's own Claude Code", () => {
    it("is found where the app keeps it: the newest version by number, on both layouts, skipping what cannot run", () => {
      const tree = join(dir, "..", `claude-code-${process.pid}`);
      const exe = (path: string, executable = true) => {
        mkdirSync(dirname(join(tree, path)), { recursive: true });
        writeFileSync(join(tree, path), "#!/bin/sh\n");
        chmodSync(join(tree, path), executable ? 0o755 : 0o644);
      };
      exe("mac/2.1.9/aaa/claude.app/Contents/MacOS/claude"); // "2.1.9" is the biggest as text, the smallest as a number
      exe("mac/2.1.326/bbb/claude.app/Contents/MacOS/claude");
      exe("mac/2.1.328/ccc/claude.app/Contents/MacOS/claude");
      exe("mac/2.1.400/ddd/claude.app/Contents/MacOS/claude", false); // cannot run: skipped
      writeFileSync(join(tree, "mac", "notes.txt"), "not a version");
      exe("win/1.0.5/claude.exe");
      exe("win/1.0.20/claude.exe");
      mkdirSync(join(tree, "empty"), { recursive: true });
      try {
        const r = probe(`
from pathlib import Path
tree = Path(${JSON.stringify(tree)})
print(json.dumps([str(m.find_claude_in(tree / n) or "") for n in ("mac", "win", "empty", "missing")]))`);
        expect(r[0].endsWith("mac/2.1.328/ccc/claude.app/Contents/MacOS/claude"), r[0]).toBe(true);
        expect(r[1].endsWith("win/1.0.20/claude.exe"), r[1]).toBe(true);
        expect(r.slice(2)).toEqual(["", ""]);
      } finally {
        rmSync(tree, { recursive: true, force: true });
      }
    });

    it("SDLC_CLAUDE_DESKTOP names it directly; a wrong path is 'not found', never a silent fallback", () => {
      const real = fake(spaced, "claude", "exit 0\n");
      const r = probe('print(json.dumps({"named": m.find_program("{claude_desktop}")}))', { SDLC_CLAUDE_DESKTOP: real });
      expect(r.named).toBe(real);
      const none = probe('print(json.dumps({"named": m.find_program("{claude_desktop}")}))', { SDLC_CLAUDE_DESKTOP: join(spaced, "nope") });
      expect(none.named).toBeNull();
    });

    it("is listed as installed with its location, or with how to get it, next to the apps you drive", () => {
      const real = fake(spaced, "claude", "exit 0\n");
      const found = out(sh(["agent", "--list"], { SDLC_CLAUDE_DESKTOP: real }));
      expect(found).toMatch(/claude-desktop\s+Claude desktop engine \(unattended\)\s+installed\s+.*Application Support/);
      expect(found).toContain("Desktop apps you drive");
      expect(found).toMatch(/handoff-claude\s+Claude desktop app \(you drive it\)/);
      expect(found).toMatch(/handoff-cursor\s+Cursor \(you drive it\)\s+found/); // a `cursor` is on PATH
      const missing = out(sh(["agent", "--list"], { SDLC_CLAUDE_DESKTOP: join(spaced, "nope") }));
      expect(missing).toMatch(/claude-desktop\s+Claude desktop engine \(unattended\)\s+not installed/);
      expect(missing).toContain("install: install the Claude desktop app: https://claude.ai/download");
    });

    it("doctor keeps the engine with the agents that run by themselves, and the apps you drive on a line of their own", () => {
      const real = fake(spaced, "claude", "exit 0\n");
      const text = out(sh(["doctor"], { SDLC_CLAUDE_DESKTOP: real }));
      expect(text).toMatch(/agents\s+installed here: claude-desktop {3}\(choose with/);
      expect(text).toMatch(/desktop apps\s+you can drive: .*handoff-cursor/); // a `cursor` is on PATH
      expect(text).not.toMatch(/installed here: .*handoff-/);
    });

    it("runs unattended like `claude -p`, even when its path has a space in it", () => {
      const logs = join(dir, "..", `engine-${process.pid}`);
      mkdirSync(logs, { recursive: true });
      const real = fake(spaced, "claude", `printf '%s\\n' "$@" > '${logs}/args'\ncat > '${logs}/stdin'\nexit 0\n`);
      const run = sh(["spec", "requirements.md", "--allow-dirty", "--agent", "claude-desktop", "--max-attempts", "1"], { SDLC_CLAUDE_DESKTOP: real }, `${bin}:/usr/bin:/bin`);
      try {
        expect(readFileSync(join(logs, "args"), "utf8").split("\n").slice(0, 3)).toEqual(["-p", "--permission-mode", "acceptEdits"]);
        expect(readFileSync(join(logs, "stdin"), "utf8")).toContain("A customer logs in");
        const evidence = join(dir, ".ai", "evidence");
        const latest = readdirSync(evidence).filter((n) => /-spec-requirements/.test(n)).sort().pop()!;
        const header = readFileSync(join(evidence, latest, "spec-1.agent.log"), "utf8").split("\n")[0]!;
        expect(header).toContain(`'${real}' -p --permission-mode acceptEdits`);
        expect(out(run)).toContain("running agent: '");
      } finally {
        rmSync(logs, { recursive: true, force: true });
        rmSync(join(dir, ".ai", "specs", "FEAT-001-requirements"), { recursive: true, force: true });
      }
    });

    it("that is not installed: spec says so and shows every option instead of failing blindly", () => {
      const run = sh(["spec", "requirements.md", "--allow-dirty", "--agent", "claude-desktop"], { SDLC_CLAUDE_DESKTOP: join(spaced, "nope") });
      expect(run.status).toBe(2);
      expect(out(run)).toContain("The agent cannot run: the Claude desktop app's Claude Code was not found");
      expect(out(run)).toContain("handoff-claude");
    });

    it("an out-of-date `claude` on PATH is told about the desktop app's, which is the way out", () => {
      const old = `if [ "$1" = "--version" ]; then echo '1.0.51 (Claude Code)'; exit 0; fi
cat >/dev/null
echo 'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}}'
exit 1
`;
      const withPath = `${bin}:/usr/bin:/bin`;
      fake(bin, "claude", old);
      try {
        const real = fake(spaced, "claude", "exit 0\n");
        const hint = out(sh(["spec", "requirements.md", "--allow-dirty"], { SDLC_CLAUDE_DESKTOP: real }, withPath));
        expect(hint).toContain("The agent could not use its AI model");
        expect(hint).toContain("./scripts/sdlc agent claude-desktop");
        const alone = out(sh(["spec", "requirements.md", "--allow-dirty"], { SDLC_CLAUDE_DESKTOP: join(spaced, "nope") }, withPath));
        expect(alone, "no desktop app, no suggestion to use it").not.toContain("claude-desktop");
        expect(alone).toContain("npm install -g @anthropic-ai/claude-code@latest");
      } finally {
        rmSync(join(bin, "claude"));
        rmSync(join(dir, ".ai", "specs", "FEAT-001-requirements"), { recursive: true, force: true });
      }
    });

    it("when it is the one that failed, the advice is about the app, not about npm or a terminal login", () => {
      const withPath = `${bin}:/usr/bin:/bin`;
      try {
        const stale = fake(spaced, "claude", `if [ "$1" = "--version" ]; then echo '2.1.100 (Claude Code)'; exit 0; fi
cat >/dev/null
echo 'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: gone"}}'
exit 1
`);
        const model = out(sh(["spec", "requirements.md", "--allow-dirty", "--agent", "claude-desktop"], { SDLC_CLAUDE_DESKTOP: stale }, withPath));
        expect(model).toContain("The agent could not use its AI model");
        expect(model).toMatch(/The one that ran: .*Application Support.*claude \(2\.1\.100 \(Claude Code\)\)/);
        expect(model).toContain("Check for Updates");
        expect(model).not.toContain("npm install");
        const signedOut = fake(spaced, "claude", "cat >/dev/null\necho 'Not logged in · Please run /login'\nexit 1\n");
        const login = out(sh(["spec", "requirements.md", "--allow-dirty", "--agent", "claude-desktop"], { SDLC_CLAUDE_DESKTOP: signedOut }, withPath));
        expect(login).toContain("The agent is not signed in");
        expect(login).toContain("Open the Claude desktop app and sign in there");
        expect(login).not.toContain("type /login");
      } finally {
        rmSync(join(dir, ".ai", "specs", "FEAT-001-requirements"), { recursive: true, force: true });
      }
    });
  });

  describe("a desktop app you drive", () => {
    it("a dry run says what would happen and opens nothing", () => {
      reset();
      const run = sh(["spec", "requirements.md", "--dry-run", "--allow-dirty", "--agent", "handoff-claude"]);
      expect(run.status).toBe(0);
      const text = out(run);
      expect(text).toContain("agent command : handoff:claude");
      expect(text).toMatch(/hand-off\s+: would open Claude desktop app on .*copy the instruction, and wait for you to press Enter/);
      expect(existsSync(opened()), "a dry run must not open the app").toBe(false);
      expect(existsSync(clipboard()), "a dry run must not touch the clipboard").toBe(false);
    });

    it("without a terminal to wait in it stops before opening anything, and says what to do instead", () => {
      reset();
      const run = sh(["spec", "requirements.md", "--allow-dirty", "--agent", "handoff-cursor"]);
      expect(run.status).toBe(2);
      expect(out(run)).toContain("a desktop app you drive needs a terminal to wait in, and this is not one");
      expect(out(run)).toContain("./scripts/sdlc agent");
      expect(existsSync(opened())).toBe(false);
      // the same guard where nothing checked first (the healing loop calls the agent directly)
      const direct = probe(`
from pathlib import Path
try:
    m.run_handoff(m.load_config(), "cursor", Path(m.ROOT) / "x.prompt.md", "t", Path(m.ROOT))
except SystemExit as e:
    print(json.dumps({"exit": e.code}))`);
      expect(direct.exit).toBe(2);
      expect(existsSync(opened())).toBe(false);
    });

    it("an app the project does not know is refused, and the known ones are listed", () => {
      const run = sh(["spec", "requirements.md", "--allow-dirty", "--agent", "handoff:nope"]);
      expect(run.status).toBe(2);
      expect(out(run)).toContain("`nope` is not a desktop app this project knows (known: claude, cursor, vscode)");
    });

    it("choosing one is remembered like any agent, with what will happen", () => {
      const chosen = sh(["agent", "handoff-vscode"]);
      try {
        expect(chosen.status).toBe(0);
        expect(JSON.parse(readFileSync(join(dir, ".ai", "agent.local.json"), "utf8"))).toEqual({ preset: "handoff-vscode" });
        expect(out(chosen)).toContain("you press Enter when its agent is done");
        expect(out(sh(["agent", "--list"]))).toContain("Using now: handoff-vscode   (your choice (.ai/agent.local.json))");
      } finally {
        sh(["agent", "--reset"]);
      }
    });

    it("end to end: opens the Claude app with the instruction filled in, copies it, waits, then validates the draft", () => {
      reset();
      const r = inTerminal("draft", ["spec", "requirements.md", "--allow-dirty", "--agent", "handoff-claude"]);
      expect(r.output).toContain("== hand-off to Claude desktop app ==");
      expect(r.sent, r.output).toBe(true);
      expect(r.code, r.output).toBe(0);
      expect(r.output).toContain("Draft ready: .ai/specs/FEAT-001-requirements/");
      expect(r.output).toContain("opened Claude desktop app");
      expect(r.output).toContain("the instruction is on your clipboard");

      const copied = readFileSync(clipboard(), "utf8");
      const promptPath = /^Read (\.ai\/evidence\/\S+\/spec-1\.prompt\.md) and do exactly what it says\.$/.exec(copied)?.[1];
      expect(promptPath, copied).toBeTruthy();
      expect(readFileSync(join(dir, promptPath!), "utf8"), "the prompt the instruction points at").toContain("A customer logs in");

      const link = readFileSync(opened(), "utf8").split("\n").find((l) => l.startsWith("claude://"))!;
      expect(link).toBe(`claude://code/new?q=${encodeURIComponent(copied)}`);
      const log = readFileSync(join(dir, dirname(promptPath!), "spec-1.agent.log"), "utf8");
      expect(log).toContain("hand-off to Claude desktop app");
      expect(log).toContain(`instruction: ${copied}`);
    }, 60000);

    it("opens an editor on this project folder instead when that is the app", () => {
      reset();
      const r = inTerminal("enter", ["spec", "requirements.md", "--allow-dirty", "--agent", "handoff-cursor", "--max-attempts", "1"]);
      expect(r.output).toContain("== hand-off to Cursor ==");
      expect(r.output, "nothing drafted the spec, so validation must say so").toContain("the draft is not valid");
      expect(readFileSync(opened(), "utf8")).toContain(realpathSync(dir));
      expect(readFileSync(clipboard(), "utf8")).toMatch(/^Read \.ai\/evidence\/\S+\/spec-1\.prompt\.md and do exactly what it says\.$/);
    }, 60000);

    it("Ctrl-D at the wait stops the run: nothing is validated, nothing is claimed", () => {
      reset();
      const r = inTerminal("eof", ["spec", "requirements.md", "--allow-dirty", "--agent", "handoff-claude"]);
      expect(r.code, r.output).toBe(2);
      expect(r.output).toContain("Stopped. Nothing was verified");
      expect(r.output).not.toMatch(/draft is not valid|Draft ready/);
    }, 60000);

    it("if the app cannot be opened or there is no clipboard, it says so, shows the instruction, and still waits for you", () => {
      reset();
      const broken = join(dir, "..", `bin-broken-${process.pid}`);
      desktopFakes(broken, { clip: false, openCode: 1 });
      const r = inTerminal("draft", ["spec", "requirements.md", "--allow-dirty", "--agent", "handoff-claude"], broken);
      expect(r.output).toContain("could not open Claude desktop app for you: open it yourself");
      expect(r.output).toContain("no clipboard program found: copy the instruction below yourself");
      expect(r.output).toMatch(/Instruction for the agent: {2}Read \.ai\/evidence\/\S+\/spec-1\.prompt\.md and do exactly what it says\./);
      expect(r.code, r.output).toBe(0);
      expect(r.output).toContain("Draft ready");
      expect(existsSync(clipboard())).toBe(false);
    }, 60000);
  });
});
