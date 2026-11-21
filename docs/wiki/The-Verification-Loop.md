# The Verification Loop

Every generated project contains `./scripts/sdlc`, a small tool (standard-library Python, no installs) that decides whether work is **done**.
The rule it enforces: *done means `./scripts/sdlc verify` exits 0 and you can show its report.*

## Commands

| Command | What it does |
|---|---|
| `./scripts/sdlc doctor` | Checks your toolchain |
| `./scripts/sdlc setup` | Installs dependencies for every component |
| `./scripts/sdlc gates` | Lint, types, unit tests, build, contract, security (no running system needed) |
| `./scripts/sdlc facts` | Checks every PRD requirement against the **running** system |
| `./scripts/sdlc verify` | Gates + facts. This is exactly what CI runs |
| `./scripts/sdlc loop` | verify, then heal, then verify... until green or out of budget |
| `./scripts/sdlc spec <file>` | **Document in, draft spec out.** An agent drafts `prd.md` + `acceptance.json` from a `.pdf`, `.docx`, `.md` or `.txt`; the tool validates the draft and sends problems back to fix; **you review it** |
| `./scripts/sdlc implement <FEAT-id>` | **Spec in, verified code out.** Gives your `prd.md` + `acceptance.json` to the agent, installs what it adds, verifies, heals |
| `./scripts/sdlc sync` | Installs dependencies only if a manifest (`pyproject.toml`, `package.json`) changed since the last install |
| `./scripts/sdlc feature <name>` | `implement` plus PRD drafting from a `--brief`, and `--deploy <env>` |
| `./scripts/sdlc new <slug>` | Creates a feature spec from the template |
| `./scripts/sdlc deploy <env>` | Runs the deploy script, then checks the live URL |
| `./scripts/sdlc secrets` | Scans for committed secrets |
| `./scripts/sdlc report` | Prints the latest report |

Two launchers start the same program (`scripts/sdlc.py`): `scripts/sdlc` (bash: macOS, Linux, WSL, Git Bash) and `scripts/sdlc.cmd` (Windows: `.\scripts\sdlc.cmd <command>`). Every command and flag is identical.

Useful flags: `--only <gate-id>`, `--stage <stage>`, `--keep-going`, `--runtime docker|local|none`, `--feature FEAT-001`.

## Gates

Commands defined once in `.ai/sdlc.json` and mirrored in the CI workflow, so "green locally" and "green in CI" mean the same thing.
They run in stages: `static -> unit -> build -> contract -> facts -> security`. By default a failing stage stops the run, so you (or an agent) see one focused problem.

## Facts

Each feature folder under `.ai/specs/` has:

- `prd.md`: acceptance criteria, one per line: `- **AC-001** Given ... when ... then ...`
- `acceptance.json`: **checks** that prove them.

Verification **fails** if a criterion has no check, or a check points at a criterion that doesn't exist. Then it starts the system and runs the checks.

```json
{
  "id": "CHK-001",
  "name": "Liveness endpoint answers ok",
  "covers": ["AC-001"],
  "type": "http",
  "target": "backend",
  "path": "/health",
  "expect": { "status": 200, "json": { "status": "ok" } }
}
```

| Check type | Fields |
|---|---|
| `http` | `target` (`backend` or `web`), `method`, `path`, `headers`, `body`, `expect`: `status`, `json` (subset match), `bodyContains`, `headers`, `maxMs` |
| `cmd` | `run`, `cwd`, `expectExit`, `stdoutContains`, `pathPrepend` |
| `file` | `path`, `exists`, `contains`, `regex` |

JSON matchers: exact values, or `"$exists"`, `"$type:string"` (also number, boolean, array, object, null), `"$re:^Hello"`.

**Honesty rules:** a check that needs something the current runtime doesn't have (for example the database in `--runtime local`) is reported as `SKIP`, never as pass.
Against a *deployed* environment (`facts --no-runtime --base-url web=https://...`) only `http` checks whose target has a URL run; `cmd` and `file` checks verify the repository and are skipped there.

## Evidence

Every run writes `.ai/evidence/<run-id>/` (`report.md`, `results.json`, one log per gate, runtime logs) and refreshes `.ai/evidence/latest/`.
The report shows each criterion, the checks that prove it, and the result. CI uploads it as an artifact.

## The healing loop

```
verify -> green? -> done (exit 0)
   |
   +-> failed: fingerprint the failures
         same failure N times in a row -> stop, ask a human (exit 3)
         out of iterations              -> stop (exit 1)
         write a heal prompt from .ai/prompts/heal.md + the evidence
         run the agent (or wait for you if none is configured)
         integrity check: did the agent touch protected files?  -> stop (exit 4)
         verify again
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Verified |
| 1 | Verification failed, or the iteration budget ran out |
| 2 | Needs a human (no agent configured and not interactive, or the PRD is still a stub) |
| 3 | No progress: the same failure repeated |
| 4 | Integrity violation: files that define "correct" were changed while healing |

### Integrity guard

An agent that is told to "make the tests pass" can cheat by changing the tests. So some files are off limits:

- **Always protected:** `.ai/sdlc.json`, `scripts/sdlc*`, `.github/workflows/`.
- **Protected while healing:** `.ai/specs/` (healing fixes code, not requirements).
- **Guarded:** `.ai/contract/` may change, but the change is reported for review.

### Using an AI agent

The agent is any command that reads the prompt on standard input (or names the prompt file with `{prompt_file}`), or a **desktop app** (see [Using a Desktop App](Desktop-Apps): `claude-desktop` runs the Claude desktop app's own Claude Code unattended,
`handoff-claude`, `handoff-cursor` and `handoff-vscode` open an app and wait for you). The project's default is a preset (`claude`, `codex`,
`gemini`, `copilot`, `cursor`, `claude-desktop`, `handoff-claude`, `handoff-cursor`, `handoff-vscode`, `custom`, `none`) set with `sdlc.agent.preset` in `scaffolder.config.yaml` or in the web UI; an explicit `sdlc.agent.command` overrides the preset.
After generating, the resolved command lives in `.ai/sdlc.json` -> `agent.command`, next to the list of every preset (`agent.presets`).

Each person chooses for their own machine, installed or not:

```bash
./scripts/sdlc agent              # every agent, whether it is installed here, how to install the rest; then asks which to use
./scripts/sdlc agent codex        # or just say which (saved in .ai/agent.local.json, which is not committed)
./scripts/sdlc agent --reset      # back to the project default
```

For one run: `./scripts/sdlc implement FEAT-001 --agent gemini`, or `SDLC_AGENT_CMD='your-agent-cli' ./scripts/sdlc implement FEAT-001`. Precedence: `--agent`, `SDLC_AGENT_CMD`,
your saved choice, the project default. The choice can only select among the commands in `.ai/sdlc.json` (which the agent may not edit) or a command you typed yourself.

With no agent, the tool prints the prompt file for you (or your own AI tool) and waits. A `handoff-*` agent is the same wait with the app opened for you and the instruction on your clipboard; the integrity guard and the verification after it are identical.

`implement` and the healing loop use the same agent. **`implement`** gives it your whole spec once (the prompt `.ai/prompts/implement.md`, with your `prd.md` and
`acceptance.json` embedded); **heal** prompts (`.ai/prompts/heal.md`) then send it only the failures. Both tell it the hard rules: never edit the spec, never weaken a test,
never commit or push, ask instead of guessing.

The mechanics around the agent are tested end to end with a scripted agent. How well a particular AI follows the prompts depends on that AI, and the
`claude` / `codex` / `gemini` / `copilot` / `cursor` presets have not been run against the real tools: use `./scripts/sdlc implement <FEAT-id> --dry-run` to inspect the command and prompt first.

### Specs from documents (`spec`)

`spec` reads a requirements document, has the agent draft the two spec files with the prompt `.ai/prompts/spec.md` (the document's text is embedded; every criterion must cite its source;
gaps become `ASSUMPTION:` lines; anything that cannot be machine-verified is listed as out of scope), and then validates the draft itself:

| The tool checks | The tool cannot check (you do, see the `review-spec` skill) |
|---|---|
| every `AC-xxx` has a check; every check cites a real criterion; unique ids | that a criterion matches what the document says |
| check types are valid; `http` targets exist (a typo used to be skipped silently) | that nothing was invented or dropped |
| no `TODO(prd)` left; `acceptance.json` is valid JSON for this feature | that a check would really fail if the behaviour were wrong |
| the agent wrote only the two spec files (anything else is an integrity violation) | whether the assumptions are acceptable |

How PDFs are read, in order: `pdftotext` (poppler), `pypdf`, `mutool`, then a basic built-in reader. A scanned (image-only) PDF has no text; the agent must read the file itself or you OCR it first.
`./scripts/sdlc doctor` shows which reader is available. Text longer than 40,000 characters is truncated in the prompt (the agent is told where the full text and the original file are); for big documents run
`spec` once per feature with `--focus` and `--name`.

### Dependencies

`./scripts/sdlc sync` compares a hash of each dependency manifest with what was last installed (`.ai/evidence/installed.json`) and reinstalls only what changed.
`implement` runs it before the agent (missing toolchain) and after it (anything the agent added), and agents are told to run it after editing a manifest.

## Configure it

Everything above is configurable in `scaffolder.config.yaml`: which gates run, coverage floors, runtime mode, iteration budget,
no-progress limit, fail-fast, agent command and timeout, extra protected paths. Regenerate to apply, or edit `.ai/sdlc.json` directly (a human decision: agents are blocked from it).
