# Adopt an Existing Project

Add the verification loop and the AI operating system to a repository that already exists, without generating a stack, touching your code or replacing your CI.

```
my-repo/
  AGENTS.md          one marked block is added (your own text is never touched)
  .ai/               everything else lives here
    sdlc.json  sdlc  sdlc.cmd  sdlc.py   the runner and its configuration
    baseline.json                        what passed and what failed on adoption day
    context/commands.md                  the commands your repository defines, and where each was found
    rules/  skills/  prompts/  specs/    how to work here, playbooks for agents, feature specs
```

> **Windows:** wherever this page writes `./.ai/sdlc <command>`, type `.\.ai\sdlc.cmd <command>` (PowerShell or cmd).
> Installing the tools for your system is covered in [Setup by Operating System](Setup-by-Operating-System).

## 1. See what it would do

From the Scaffolder repository:

```bash
npm run scaffold -- adopt ../my-repo
```

Without a clone: `npx ai-scaffolder adopt ../my-repo` ([`ai-scaffolder` on npm](https://www.npmjs.com/package/ai-scaffolder); it needs only Node 20+, no account and no login). Everything on this page works the same with either command.

This is a dry run: it scans the repository, prints what it found, which gates it will run, what it could not cover, and every file it would write. Nothing is written.

It only proposes a gate when your repository defines the command itself, and says where it found it:

| Found | Becomes |
|---|---|
| `package.json` scripts `lint`, `typecheck` / `type-check`, `test`, `build` (npm, pnpm, yarn or bun, by lockfile) | `node.lint`, `node.types`, `node.test`, `node.build` |
| `pyproject.toml`, requirements files, `setup.py` with ruff, flake8, mypy or pytest configured or listed | `python.ruff`, `python.mypy`, `python.pytest` (run through `poetry run` or `uv run` for those projects) |
| a `Makefile` with `lint`, `test`, `build` targets, when there is no Node or Python project | `make.lint`, `make.test`, `make.build` |

Scripts that never end (`--watch`) and the npm placeholder test script are not made gates, and the report says so. Anything it has no detector for (Go, Rust, Java, ...) is listed under **Not covered**; add its commands yourself under `gates.add` (see [Settings](#settings)).

## 2. Write it

```bash
npm run scaffold -- adopt ../my-repo --write
```

It never overwrites a file of yours: a file that already exists and differs is kept and listed (`--force` overwrites only the files adopt generates). Running it again is safe and changes nothing when nothing changed.

## 3. Record the starting line

```bash
cd ../my-repo
./.ai/sdlc doctor      # are the tools installed? (also checks the baseline)
./.ai/sdlc setup       # install dependencies; an existing node_modules or virtual environment is used as it is
./.ai/sdlc baseline    # run every gate once and record the result
```

Then **commit `.ai/` including `baseline.json`**. `./.ai/sdlc implement` starts only from a clean tree, so that you can review exactly what the agent changes.

## 4. Let an agent describe the repository (optional, recommended)

```bash
./.ai/sdlc onboard
```

An agent reads the repository and drafts the two files every later agent run reads first:

- `.ai/context/architecture.md`: purpose, layout, entry points, key flows, data and integrations, open questions
- `.ai/rules/conventions.md`: how this code does things (naming, layering, errors, configuration, tests), each convention with the file that shows it

Guidance that was already in the repository (`CLAUDE.md`, `AGENTS.md` outside the generated block, `.cursor/rules/`, `.github/copilot-instructions.md`, `CONVENTIONS.md`) is read and folded in, with its source named. Where it contradicts the code, the draft lists the conflict instead of picking a side.

An AI's description of a code base is only worth having if it is true, so the tool checks what can be checked against the repository and sends the agent back to fix what fails:

- every path cited in backticks exists (`src/api/`, `backend/app/main.py:12`, globs like `src/*.ts`). Routes (`/api/users`), URLs, MIME types, package names and anything inside a code fence are not treated as paths. A bare name (`ConfigForm.tsx`, `core/`, `*.test.ts`, `.test.ts`) is accepted when a file or folder like it exists anywhere in the repository and rejected when none does, a path that git ignores (a build output) is accepted, and a wrong full path gets a "did you mean" hint
- every `npm run <script>` (also pnpm, yarn, bun), `make <target>` and `./.ai/sdlc <command>` it names exists
- every bold-led item points at code that exists, so a convention without evidence is rejected
- the required sections are there, there are no placeholders, and the first lines say `Status: Draft`

What it cannot check is whether the description is *right*. Both files stay marked `Status: Draft`, and `doctor` and `implement` remind you until you have read them, corrected them, changed the line to `Status: Reviewed` and committed them: agents read these files before every task, so a wrong sentence misleads every one of them.

The agent may write those two files and nothing else: a change to code, `CLAUDE.md` or the gate configuration stops the run with exit code 4. It starts from a clean tree, will not overwrite files that exist (`--force` redrafts them and keeps your versions in the evidence folder), keeps the draft of every attempt in the run's evidence folder, and `--dry-run` shows the prompt first.

## 5. What "done" means for existing code

Existing code is rarely green, so "done" is not "everything passes". It is **nothing that passed on adoption day fails now**, plus every acceptance criterion of the feature at hand:

```bash
./.ai/sdlc verify
```

- A gate that passed at the baseline must still pass; if it fails, `verify` reports `FAIL`.
- A gate that already failed at the baseline shows as `WARN ... known`. It does not block, and an agent is told it is not its job, unless the feature is about it.
- When a known failing gate starts passing, `verify` says so. `./.ai/sdlc baseline --tighten` locks the gain in, and refuses to run while something that passed at the baseline is failing.
- Secrets already in the repository are recorded as known by `baseline` (the secret text itself is never copied); a new one fails the `repo.secrets` gate. They are still in your repository: review them and rotate anything real.

The baseline is per gate, not per violation. A gate that was already red can get worse without `verify` noticing, so tighten as gates turn green.
**Record the baseline where you verify.** A gate that passes on your laptop but fails in CI (a missing tool, another OS) would look like a regression there.

## 6. Build a feature

```bash
./.ai/sdlc new export-csv                 # an empty spec to fill in
./.ai/sdlc spec requirements.pdf          # or: an agent drafts it from a document (.pdf .docx .md .txt); you review it
./.ai/sdlc implement FEAT-001             # an agent writes tests and code; the loop proves it; nothing is committed
```

A spec is `prd.md` (acceptance criteria `AC-001` ...) and `acceptance.json` (the checks that prove each one). The template adds a section, **Existing behaviour that must keep working**, because for existing code what a change must not break matters as much as what it adds.
The agent is told to read the code around the change and match it, to make the smallest diff, to leave known-red gates alone, and never to edit the specification, the gate configuration, the baseline or your workflows (the loop stops with exit code 4 if it does). Changes it makes to your lint, type and test configuration are allowed but listed for review.
Pick the agent with `./.ai/sdlc agent`; see [Using a Desktop App](Desktop-Apps) for the Claude desktop app, Cursor and VS Code.

Facts are `cmd` checks (run the one test that proves the criterion) and `file` checks. To check HTTP behaviour against the live app, declare how to start it; see "Run the app for facts" in `.ai/README.md`.

## Settings

Everything has a default from what was detected, so the settings file is optional. Pass one with `--config adopt.yaml`, or change single values with `--set`:

```yaml
version: 1
project: { name: my-shop }
gates:
  exclude: [node.build]                # drop a detected gate
  add:                                 # a stack nothing detects
    - { id: go.test, label: Go tests, stage: unit, cmd: "go test ./...", timeoutSeconds: 600 }
sdlc:
  maxIterations: 5
  agent: { preset: claude }
  protectedPaths: [infra/]             # an agent may never edit these
rootFile: agents-block                 # "none": write nothing outside .ai/
```

```bash
npm run scaffold -- adopt ../my-repo --write --config adopt.yaml --set rootFile=none
```

## Your CI and your existing agent files

Your CI is left alone, and it does not know about the baseline. The generated `.ai/README.md` has the small job to add (`./.ai/sdlc setup`, then `./.ai/sdlc verify`); workflows are protected from agents, so a person adds it.
Instruction files that were already in the repository (`CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`, ...) are not replaced: the `AGENTS.md` block points agents at them. Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so add the line `@AGENTS.md` to your `CLAUDE.md` (adopt reminds you).

## What is and is not verified

Verified by tests: detection on in-memory repositories (npm, pnpm, yarn, bun, workspaces, Poetry, uv, pip, existing virtual environments, Makefile), generation for five kinds of repository, the overlay writer (idempotent, never overwrites yours), and the generated runner driven in real throwaway git repositories: baseline, known failures, regressions, `--tighten`, the secrets baseline, `implement` and healing with a scripted agent, integrity violations, and an existing `node_modules` left alone. `onboard` is tested with scripted agents: the prompt it builds, every check above (each kind of bad draft is sent back and the corrected draft accepted), the files it protects, `--force`, and the draft reminders in `doctor` and `implement`.

Run for real: `onboard` with the `claude` agent (Claude Code 2.1.328) on scratch clones of this repository, four runs, three of them from nothing. The first drafts failed the checks on 34, 12 and 3 points; most of the first two were false alarms from the checker itself (bare file and folder names under a folder the draft had just named, globs, build outputs that git ignores), which it now accepts, and a name that exists nowhere is still rejected. Every run ended with a draft that passed (75 to 86 cited paths and 4 to 8 commands, all real), I checked about ten of its claims against the code by hand and all were true, and a planted `CLAUDE.md` that said Jest with co-located tests was reported as a conflict with the code (Vitest, `__tests__/`) in every run. That is one TypeScript repository and one agent.

Not verified: a real third-party repository, the `codex`, `gemini`, `copilot` and `cursor` agents against an adopted project, how useful the drafts are to people over time, Windows, creating a Python virtual environment and installing with pnpm, yarn, bun, Poetry or uv (those setup commands are generated and unit-tested, never executed here), and HTTP facts against a live app of an adopted project.
Not built yet: a coverage or test-count ratchet (a gate runs your own thresholds; nothing measures them), a way to refresh a generated `.ai/` after Scaffolder changes other than `--force`, and the web UI.
