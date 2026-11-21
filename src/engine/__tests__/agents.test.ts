import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_PRESETS, DESKTOP_APPS, HANDOFF_PREFIX } from "../capabilities";
import { agentCommand, defaultConfig, deepMerge, validateConfig } from "../config";
import { generateProject } from "../generate";

type Json = Record<string, any>;

describe("agent presets: several agents to choose from, installed or not", () => {
  const withCommand = AGENT_PRESETS.filter((p) => p.command);

  it("offers five CLIs, the Claude desktop app's engine, three desktop apps you drive, a custom command and none", () => {
    expect(AGENT_PRESETS.map((p) => p.id)).toEqual([
      "claude", "codex", "gemini", "copilot", "cursor", "claude-desktop", "handoff-claude", "handoff-cursor", "handoff-vscode", "custom", "none",
    ]);
  });

  it("every program-backed agent says which program it needs, how to install it and where its docs are", () => {
    for (const p of withCommand.filter((x) => !x.command.startsWith(HANDOFF_PREFIX))) {
      expect(p.command.split(/\s+/)[0], p.id).toBe(p.program);
      expect(p.mode, p.id).toBe("headless");
      expect(p.install, `${p.id} has no install hint`).not.toBe("");
      expect(p.docs, p.id).toMatch(/^https:\/\//);
    }
    for (const p of AGENT_PRESETS.filter((x) => !x.command)) expect([p.program, p.install, p.docs], p.id).toEqual(["", "", ""]);
  });

  it("every desktop-app preset names an app that is defined, and says how to install it", () => {
    const apps = withCommand.filter((p) => p.command.startsWith(HANDOFF_PREFIX));
    expect(apps.map((p) => p.command.slice(HANDOFF_PREFIX.length))).toEqual(DESKTOP_APPS.map((a) => a.id));
    for (const p of apps) {
      expect([p.mode, p.program], p.id).toEqual(["handoff", ""]);
      expect(p.install, p.id).not.toBe("");
      expect(p.docs, p.id).toMatch(/^https:\/\//);
    }
  });

  it("an agent that takes the prompt as an argument is pointed at the prompt file, one that reads stdin is not", () => {
    for (const id of ["copilot", "cursor"]) expect(AGENT_PRESETS.find((p) => p.id === id)!.command, id).toContain("{prompt_file}");
    for (const id of ["claude", "codex", "gemini"]) expect(AGENT_PRESETS.find((p) => p.id === id)!.command, id).not.toContain("{prompt_file}");
  });

  it("every preset is a valid choice in the config, and an unknown one lists them all", () => {
    for (const p of AGENT_PRESETS.filter((x) => x.id !== "custom")) {
      const issues = validateConfig(deepMerge(defaultConfig(), { sdlc: { agent: { preset: p.id } } }));
      expect(issues.filter((i) => i.path === "sdlc.agent.preset"), p.id).toEqual([]);
    }
    const bad = validateConfig(deepMerge(defaultConfig(), { sdlc: { agent: { preset: "nope" } } })).find((i) => i.path === "sdlc.agent.preset")!;
    for (const id of ["claude", "codex", "gemini", "copilot", "cursor"]) expect(bad.message).toContain(id);
  });

  it("sdlc.json carries every agent (the file the agent may not edit), and the default one is resolved", () => {
    const files = generateProject(defaultConfig()).files;
    const cfg = JSON.parse(files.find((f) => f.path === ".ai/sdlc.json")!.content) as Json;
    expect(cfg.agent.presets.map((p: Json) => p.id)).toEqual(withCommand.map((p) => p.id));
    for (const p of cfg.agent.presets) expect(p.command, p.id).toBe(AGENT_PRESETS.find((x) => x.id === p.id)!.command);
    expect(cfg.agent.command).toBe(agentCommand(defaultConfig()));
    expect(cfg.integrity.protected).toContain(".ai/sdlc.json");
  });

  it("a person's own choice is kept out of git", () => {
    const ignore = generateProject(defaultConfig()).files.find((f) => f.path === ".gitignore")!.content;
    expect(ignore).toContain(".ai/agent.local.json");
  });
});

/**
 * The `agent` command and how a choice is used, in a real generated project with fake agent programs on PATH
 * (shell scripts, so POSIX only; the cross-platform smoke test runs `agent --list` and a choice on Windows too).
 */
describe.skipIf(process.platform === "win32")("sdlc agent: list, choose, and use the choice", () => {
  let dir = "";
  let bin = "";
  let python = "";
  const sh = (command: string[], extra: Record<string, string> = {}, input?: string) =>
    spawnSync(python, ["-I", join(dir, "scripts", "sdlc.py"), ...command], {
      cwd: dir,
      encoding: "utf8",
      input,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, NO_COLOR: "1", SDLC_AGENT_CMD: undefined as any, ...extra },
    });
  const out = (r: ReturnType<typeof sh>) => `${r.stdout}${r.stderr}`;
  const fake = (name: string, body = "cat >/dev/null\nexit 0\n") => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}`);
    chmodSync(join(bin, name), 0o755);
  };
  const local = () => join(dir, ".ai", "agent.local.json");

  beforeAll(() => {
    const probe = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
    python = (probe.stdout || "").trim();
    dir = mkdtempSync(join(tmpdir(), "scaffolder-agent-"));
    bin = join(dir, "..", `fakebin-${process.pid}`);
    mkdirSync(bin, { recursive: true });
    for (const f of generateProject(defaultConfig()).files) {
      const full = join(dir, f.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.content);
    }
    writeFileSync(join(dir, "requirements.md"), "# Login\n\nA customer logs in with an email and a password and gets a token.\n");
    fake("codex");
    fake("gemini");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  it("lists every agent, says which are installed here and how to install the rest", () => {
    const text = out(sh(["agent", "--list"]));
    expect(text).toMatch(/codex\s+OpenAI Codex.*installed/);
    expect(text).toMatch(/gemini\s+Google Gemini CLI.*installed/);
    expect(text).toMatch(/claude\s+Claude Code.*not installed/);
    expect(text).toContain("install: npm install -g @anthropic-ai/claude-code");
    expect(text).toContain("install: npm install -g @github/copilot");
    expect(text).toContain("Using now: claude   (the project default)");
    expect(existsSync(local())).toBe(false); // listing never changes anything
  });

  it("remembers a choice outside git, and the choice is what spec and implement use", () => {
    const chosen = sh(["agent", "gemini"]);
    expect(chosen.status).toBe(0);
    expect(JSON.parse(readFileSync(local(), "utf8"))).toEqual({ preset: "gemini" });
    expect(out(sh(["agent", "--list"]))).toContain("Using now: gemini   (your choice (.ai/agent.local.json))");
    const dry = out(sh(["spec", "requirements.md", "--dry-run", "--allow-dirty"]));
    expect(dry).toContain('agent command : gemini --approval-mode yolo -p "Carry out the instructions given above."');
  });

  it("an explicit --agent, then SDLC_AGENT_CMD, beat the saved choice; a name or a command both work", () => {
    sh(["agent", "gemini"]);
    const byName = out(sh(["spec", "requirements.md", "--dry-run", "--allow-dirty", "--agent", "codex"]));
    expect(byName).toContain("agent command : codex exec --sandbox workspace-write -");
    const byEnv = out(sh(["spec", "requirements.md", "--dry-run", "--allow-dirty"], { SDLC_AGENT_CMD: "codex" }));
    expect(byEnv).toContain("agent command : codex exec --sandbox workspace-write -");
    const raw = out(sh(["spec", "requirements.md", "--dry-run", "--allow-dirty", "--agent", "codex exec --full-auto -"]));
    expect(raw).toContain("agent command : codex exec --full-auto -");
  });

  it("a custom command is saved as given; --reset goes back to the project default", () => {
    expect(sh(["agent", "custom"]).status, "custom without a command must be refused").not.toBe(0);
    const chosen = sh(["agent", "custom", "--command", "my-agent --stdin"]);
    expect(chosen.status).toBe(0);
    expect(JSON.parse(readFileSync(local(), "utf8"))).toEqual({ preset: "custom", command: "my-agent --stdin" });
    expect(out(chosen)).toContain("`my-agent` is not installed"); // saved anyway, with a warning
    const reset = sh(["agent", "--reset"]);
    expect(reset.status).toBe(0);
    expect(existsSync(local())).toBe(false);
    expect(out(reset)).toContain("(the project default)");
  });

  it("an unknown name is refused and lists the valid ones; an agent that is not installed can still be chosen", () => {
    const unknown = sh(["agent", "nope"]);
    expect(unknown.status).not.toBe(0);
    expect(out(unknown)).toContain("claude, codex, gemini, copilot, cursor, claude-desktop, handoff-claude, handoff-cursor, handoff-vscode, custom, none");
    expect(existsSync(local())).toBe(false);
    const copilot = sh(["agent", "copilot"]);
    expect(copilot.status).toBe(0);
    expect(out(copilot)).toContain("Install it with: npm install -g @github/copilot");
    sh(["agent", "--reset"]);
  });

  it("when the agent is not installed, spec shows every option instead of only failing (no terminal: it does not wait)", () => {
    const run = sh(["spec", "requirements.md", "--allow-dirty"]);
    expect(run.status).toBe(2);
    const text = out(run);
    expect(text).toContain("The agent cannot run: `claude` is not installed or not on PATH.");
    expect(text).toMatch(/codex\s+OpenAI Codex.*installed/);
    expect(text).toContain("./scripts/sdlc agent <name>");
  });

  it("an agent that takes the prompt as an argument gets the path of the prompt file it can read", () => {
    const log = join(dir, "copilot-args.log");
    fake("copilot", `printf '%s\\n' "$@" > '${log}'\ncat >/dev/null\nexit 0\n`);
    sh(["spec", "requirements.md", "--allow-dirty", "--agent", "copilot", "--max-attempts", "1"]);
    const args = readFileSync(log, "utf8").split("\n");
    expect(args[0]).toBe("-p");
    const sentence = args[1];
    expect(sentence).not.toContain("{prompt_file}");
    const promptPath = /Read (\S+) and do exactly/.exec(sentence)?.[1];
    expect(promptPath, sentence).toMatch(/^\.ai\/evidence\/.+\/spec-1\.prompt\.md$/);
    expect(readFileSync(join(dir, promptPath!), "utf8")).toContain("Login");
    expect(args).toContain("--allow-all-tools");
  });

  const evidenceRuns = () => {
    const root = join(dir, ".ai", "evidence");
    // two runs in the same second get a "-2" suffix, so match that too
    return readdirSync(root).filter((n) => /-spec-requirements(-\d+)?$/.test(n)).sort();
  };

  it("an agent that is not signed in is reported as that, once, instead of 'the draft has TODO placeholders' three times", () => {
    fake("claude", "echo 'Not logged in · Please run /login'\nexit 1\n");
    const before = evidenceRuns().length;
    const run = sh(["spec", "requirements.md", "--allow-dirty"]);
    expect(run.status).toBe(2);
    const text = out(run);
    expect(text).toContain("agent said: Not logged in · Please run /login");
    expect(text).toContain("The agent is not signed in, so it did nothing");
    expect(text).toContain("Run `claude` once in a terminal and sign in (type /login)");
    expect(text).toContain("./scripts/sdlc agent");
    expect(text, "must not go on to validate and retry").not.toMatch(/draft is not valid|attempt 2/);
    const runs = evidenceRuns();
    expect(runs.length).toBe(before + 1);
    const logs = readdirSync(join(dir, ".ai", "evidence", runs[runs.length - 1]!)).filter((n) => n.endsWith(".agent.log"));
    expect(logs).toEqual(["spec-1.agent.log"]);
    rmSync(join(bin, "claude"));
  });

  it("an agent whose model no longer exists (an out-of-date CLI) is named as that, with its version, and stops the run", () => {
    fake(
      "claude",
      `if [ "$1" = "--version" ]; then echo '1.0.51 (Claude Code)'; exit 0; fi
cat >/dev/null
echo 'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}}'
exit 1
`,
    );
    const run = sh(["spec", "requirements.md", "--allow-dirty"]);
    expect(run.status).toBe(2);
    const text = out(run);
    expect(text).toContain("agent said: API Error: 404");
    expect(text).toContain("The agent could not use its AI model, so it did nothing");
    expect(text).toMatch(/The one that ran: .*claude \(1\.0\.51 \(Claude Code\)\)/);
    expect(text).toContain("npm install -g @anthropic-ai/claude-code@latest");
    expect(text).toContain("which -a claude");
    expect(text).not.toContain("not signed in");
    expect(text, "must not go on to validate and retry").not.toMatch(/draft is not valid|attempt 2/);
    rmSync(join(bin, "claude"));
  });

  it("only a missing model counts: a rate limit is still just 'any other failure'", () => {
    const PROBE = `
import importlib.util, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("sdlc", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def kind(text, code=1):
    d = Path(tempfile.mkdtemp()); (d / "t.agent.log").write_text(text, encoding="utf-8")
    return m.agent_blocker(d, "t", code)
print(kind('API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}}'))
print(kind("Error: model 'gpt-3' does not exist"))
print(kind("Not logged in · Please run /login"))
print(kind("rate limit reached, try again in a minute"))
print(kind('API Error: 404 {"type":"error","error":{"type":"not_found_error"}}', code=0))
`;
    const r = spawnSync(python, ["-I", "-c", PROBE, join(dir, "scripts", "sdlc.py")], { cwd: dir, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout.split("\n").slice(0, 5)).toEqual(["model", "model", "signed_out", "", ""]);
  });

  it("any other agent failure shows what the agent said, and validation still decides about the draft", () => {
    fake("codex", "echo 'rate limit reached, try again in a minute'\nexit 1\n");
    const run = sh(["spec", "requirements.md", "--allow-dirty", "--agent", "codex", "--max-attempts", "1"]);
    const text = out(run);
    expect(text).toContain("agent said: rate limit reached, try again in a minute");
    expect(text).not.toContain("not signed in");
    expect(text).toContain("the agent exited with 1; validation below decides");
    fake("codex");
  });

  it("choosing in a terminal: a number saves it, Enter keeps things, a bad number or a custom command is handled", () => {
    const PROBE = `
import builtins, importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("sdlc", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cfg = m.load_config()
def ask(*answers):
    it = iter(answers)
    def fake_input(*_a):
        try:
            return next(it)
        except StopIteration:
            raise EOFError  # the terminal was closed
    builtins.input = fake_input
    return m.choose_agent_interactive(cfg)
def saved():
    return json.load(open(m.AGENT_LOCAL)) if os.path.exists(m.AGENT_LOCAL) else None
results = {}
results["enter"] = [ask(""), saved()]
results["bad number"] = [ask("99"), saved()]
results["number 2"] = [ask("2"), saved()]
results["by name"] = [ask("gemini"), saved()]
results["custom"] = [ask("c", "my-agent --x"), saved()]
results["none"] = [ask("n"), saved()]
results["eof"] = [ask(), saved()]
print(json.dumps(results))
`;
    writeFileSync(join(dir, "probe.py"), PROBE);
    const run = spawnSync(python, ["-I", join(dir, "probe.py"), join(dir, "scripts", "sdlc.py")], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, NO_COLOR: "1" } });
    expect(run.status, run.stderr).toBe(0);
    const lines = run.stdout.trim().split("\n");
    const r = JSON.parse(lines[lines.length - 1]) as Record<string, [string | null, Json | null]>;
    expect(r["enter"]).toEqual([null, null]);
    expect(r["bad number"]).toEqual([null, null]);
    expect(r["number 2"][1]).toEqual({ preset: "codex" });
    expect(r["number 2"][0]).toBe(AGENT_PRESETS.find((p) => p.id === "codex")!.command);
    expect(r["by name"][1]).toEqual({ preset: "gemini" });
    expect(r["custom"]).toEqual(["my-agent --x", { preset: "custom", command: "my-agent --x" }]);
    expect(r["none"]).toEqual(["", { preset: "none" }]);
    expect(r["eof"][0]).toBeNull();
    rmSync(local(), { force: true });
  });
});
