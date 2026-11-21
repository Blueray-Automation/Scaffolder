# Using a Desktop App Instead of a CLI

`spec`, `implement` and the healing loop need an AI agent. That agent does **not** have to be a command-line program on your `PATH`. There are two ways to use a desktop app:

| You want | Choose | Runs by itself? | Needs |
|---|---|---|---|
| The Claude desktop app's Claude Code, with no `claude` CLI on `PATH` (and no stale one getting in the way) | [`claude-desktop`](#the-claude-desktop-apps-own-claude-code-claude-desktop) | yes, unattended, like `claude -p` | the Claude desktop app, opened once and signed in |
| Any desktop coding app: the Claude desktop app's **Code tab**, **Cursor**, **VS Code** | [`handoff-claude`, `handoff-cursor`, `handoff-vscode`](#drive-a-desktop-app-yourself-hand-off) | no: the tool opens the app, you press **Enter** when its agent is done | a terminal to wait in |

Everything else is the same as with any agent: the spec is checked first, the tree must be clean, the agent may not edit the spec or the gate files (the integrity guard), dependencies it adds are installed,
and the result is verified against the running system and healed until green. The desktop app only replaces *who does the coding*.

## The Claude desktop app's own Claude Code (`claude-desktop`)

The Claude desktop app's Code tab runs **its own copy** of Claude Code. The app downloads and updates that copy, so it can be newer than the `claude` command in your terminal, and updating one does not update the other
([Claude Code on desktop](https://code.claude.com/docs/en/desktop)). That is exactly the situation behind the [`not_found_error ... model` failure](Troubleshooting#agent-said-api-error-404--not_found_error--model-claude---the-agent-could-not-use-its-ai-model):
an old `claude` on `PATH` asks for a model that has since been retired. The `claude-desktop` agent skips the CLI and runs the desktop app's copy instead, with the same flags as the `claude` preset:

```bash
./scripts/sdlc agent               # claude-desktop shows "installed" and where it was found
./scripts/sdlc agent claude-desktop
./scripts/sdlc spec requirements.pdf
```

```text
   6  claude-desktop  Claude desktop engine (unattended) installed     /Users/you/Library/Application Support/Claude/claude-code/2.1.328/.../claude.app/Contents/MacOS/claude
```

**Where the tool looks.** On macOS the app keeps one folder per version under `~/Library/Application Support/Claude/claude-code/` and the tool uses the newest (compared as numbers, so `2.1.328` beats `2.1.9`).
This was checked on a real machine: the program there ran headless, was signed in with the app's account, and answered a prompt through the tool's own agent runner.
On Windows the tool looks in the same-named folders under `%APPDATA%` and `%LOCALAPPDATA%` (`...\Claude\claude-code\<version>\claude.exe`), and on Linux (the app is in beta there) under `~/.config/Claude/claude-code`.
Those follow the app's per-user data convention, but **they have not been checked on a Windows or Linux machine**. If your copy lives somewhere else, name the program directly:

```bash
SDLC_CLAUDE_DESKTOP="/path/to/claude" ./scripts/sdlc spec requirements.pdf --agent claude-desktop
```

(A path that does not exist means "not found": it never silently falls back to another program.)

- **Update it** from the app: **Claude > Check for Updates...** on macOS, **Help > Check for Updates...** on Windows, then start a new session. Type `/status` in a Code-tab session to see which version it runs.
- **Sign in** in the app. If the tool says the agent is not signed in, open the Claude desktop app and sign in there, then run the command again.
- **Not found?** Install the app from [claude.ai/download](https://claude.ai/download) and open it once: it downloads its Claude Code the first time it needs it. `./scripts/sdlc doctor` shows whether it is found.
- If an old `claude` on `PATH` *is* the agent and fails with the retired-model message, the tool now also tells you about this alternative whenever it finds the desktop app's copy.

## Drive a desktop app yourself (hand-off)

A desktop app that has a chat or agent panel but no headless mode cannot be started by a program. A **hand-off** agent works around that without giving up the checks:
the tool prepares everything, hands over to you, waits, and then checks the result itself.

```bash
./scripts/sdlc agent handoff-claude        # or handoff-cursor, handoff-vscode
./scripts/sdlc implement FEAT-001
```

```text
== agent: implementing ==

== hand-off to Claude desktop app ==
  opened Claude desktop app
  the instruction is on your clipboard

  Instruction for the agent:  Read .ai/evidence/20261121-101500-implement-FEAT-001/implement-FEAT-001.prompt.md and do exactly what it says.

  In the Claude desktop app's Code tab a new session opens with the instruction in the prompt box (it is also on your clipboard). Choose this project's folder, check the permission mode, and send it.
  The agent may edit code, tests and dependencies. It may not edit the spec or the gate files: this tool checks that afterwards.

Press Enter when the agent has finished (Ctrl-C to stop):
```

What happens, in order:

1. The tool writes the full prompt (your spec, the rules, or the failures to heal) to a file under `.ai/evidence/`, exactly as it does for a CLI agent.
2. It **opens the app**. For the Claude desktop app that is the documented new-session link `claude://code/new?q=...`, which opens the Code tab's new-session page with the instruction in the prompt box (Desktop fills it in and never sends it for you).
   For Cursor and VS Code it opens this project folder in the editor.
3. It puts the one-line instruction (*read this prompt file and do what it says*) **on your clipboard** and prints it. The prompt itself can be thousands of lines, which is why the instruction points at the file instead of carrying it.
4. **You** let the agent work in the app: choose this project's folder in the Code tab (the link cannot select a local folder), paste the instruction where the app did not already, approve what it asks to run.
5. You press **Enter**. From here on nothing differs from a CLI agent: the integrity guard compares the protected files (a spec or gate file the agent touched stops the run), `spec` validates the draft and `implement` installs dependencies and verifies and heals.
   During healing the tool hands over again for each round, with the failures as the prompt.

| Preset | Opens | In the app |
|---|---|---|
| `handoff-claude` | the Claude desktop app, new Code-tab session with the instruction filled in | choose the project folder, send |
| `handoff-cursor` | this folder in Cursor | open the agent chat, paste, let it work |
| `handoff-vscode` | this folder in VS Code | open Copilot Chat in Agent mode (or the Claude Code panel), paste, let it work |

Things to know:

- **It needs a terminal.** The tool waits for you, so without a terminal (CI, a pipe) it stops *before* opening anything and says so. Ctrl-C (or closing the terminal input) at the wait stops the run: nothing is verified or claimed.
- **Opening is a convenience, not a requirement.** If the app cannot be opened for you, or no clipboard program exists (`pbcopy`, `clip`, `wl-copy`, `xclip` or `xsel`), the tool says so, prints the instruction and still waits.
- **`--dry-run` opens nothing.** `./scripts/sdlc spec requirements.pdf --agent handoff-cursor --dry-run` shows what would happen.
- **One run only:** `./scripts/sdlc implement FEAT-001 --agent handoff-vscode`. Or the project's default: **Verification loop -> AI agent** in the web UI, or `sdlc.agent.preset` in `scaffolder.config.yaml`.
- **"Found" is a best guess.** The list says an app is *found* when it sits in the usual place (or its command is on `PATH`); an app installed elsewhere shows *not found here* and can still be chosen.

## How much was tested

- **Tested with fakes, end to end:** the hand-off in a real pseudo-terminal (opens the app with the right link or folder, fills the clipboard, waits, validates the draft the "person" wrote, stops on Ctrl-D, copes with an app that will not open and with no clipboard program), and the `claude-desktop` locator (newest version by number, macOS and Windows folder layouts, non-runnable files skipped, a path with spaces).
- **Run for real:** on macOS, `claude-desktop` found the Claude desktop app's own Claude Code (2.1.328) and ran a one-word prompt through the tool's agent runner (exit 0).
- **Not run:** the apps' own windows. Nobody here drove the Code tab, Cursor or VS Code through a full `implement`; their UIs change, and the steps the tool prints are a guide. The Windows and Linux launchers and the Windows and Linux `claude-code` folders follow each app's conventions but were not run on those systems.
