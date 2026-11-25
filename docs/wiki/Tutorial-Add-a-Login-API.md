# Tutorial: Add a Login API

Start from a **requirements document** (or write two small files yourself). An AI agent drafts the spec, **you review it**, and one more command builds everything else:
the tests, the code, the new dependencies, the config, the API contract, and the proof that it all works.

```
Route A, from a document:          Route B, by hand:
  ./scripts/sdlc spec requirements.pdf        ./scripts/sdlc new user-login
   agent drafts prd.md + acceptance.json       you write prd.md + acceptance.json
   tool validates the draft
  YOU REVIEW the draft  <------ the contract, so a human always signs it off
        |
        v
  ./scripts/sdlc implement FEAT-001
   tool:  checks the spec, installs the toolchain, runs a baseline
   agent: reads the spec as its prompt; writes tests, code, dependencies, config, contract
   tool:  installs what the agent added, verifies against the running system
   loop:  failures go back to the agent until green (or it stops and asks you)
        |
        v
  you: git diff, commit, push, PR            nothing is committed for you
```

> **How much was tested.** Everything around the agent (reading the document, the prompt, validation and retries, the spec check, the baseline, dependency install,
> the integrity guard, questions, verification) is tested end to end with a *scripted* agent that does what a good AI is told to do. The `claude`, `codex`, `gemini`, `copilot` and `cursor`
> presets follow each tool's documented non-interactive mode but have **not been run against the real tools**, so how well a particular AI drafts specs and writes code is untested here.
> The desktop options ([`claude-desktop` and the `handoff-*` agents](Desktop-Apps)) are covered the same way: tested end to end with fakes, and `claude-desktop` was also run once for real on macOS; the apps' own windows were not driven.
> Use `--dry-run` first (below) and expect to tune your first prompt.

## Before you start (once)

1. A project from [Getting Started](Getting-Started) that passes `./scripts/sdlc verify`.
2. An **AI agent**: a CLI, or a desktop app (the Claude desktop app, Cursor, VS Code: see [Using a Desktop App](Desktop-Apps)), installed and signed in. You do not have to decide this up front, and it does not have to be the project's default: see which are installed on
   your machine and pick one with `./scripts/sdlc agent` (below). The project's default comes from the web UI (**Verification loop -> AI agent**) or `sdlc.agent.preset`
   in `scaffolder.config.yaml`:

| Preset | Runs | Notes |
|---|---|---|
| `claude` (default) | `claude -p ...` ([headless mode docs](https://code.claude.com/docs/en/headless)) | needs the Claude Code CLI on your `PATH`; it can also read PDFs itself |
| `codex` | `codex exec --sandbox workspace-write -` ([docs](https://developers.openai.com/codex/noninteractive)) | needs the Codex CLI; its sandbox may block network, which is why dependencies are installed by the tool, not the agent |
| `gemini` | `gemini --approval-mode yolo -p ...` ([docs](https://geminicli.com/docs/cli/headless/)) | needs the Gemini CLI; `yolo` approves every action, which it needs to run the tests |
| `copilot` | `copilot -p "Read <prompt file> ..." --allow-all-tools` ([docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically)) | needs the Copilot CLI and a Copilot subscription; it takes the prompt as an argument, so it is pointed at the prompt file |
| `cursor` | `cursor-agent -p --force "Read <prompt file> ..."` ([docs](https://cursor.com/docs/cli/headless)) | needs the Cursor CLI; `--force` lets it edit files |
| `claude-desktop` | the same flags as `claude`, run with the Claude Code that the **Claude desktop app** keeps for its Code tab ([details](Desktop-Apps#the-claude-desktop-apps-own-claude-code-claude-desktop)) | needs the Claude desktop app, opened once and signed in; no `claude` on `PATH` needed, and no stale one in the way |
| `handoff-claude`, `handoff-cursor`, `handoff-vscode` | opens the **Claude desktop app's Code tab**, Cursor or VS Code and waits for you ([details](Desktop-Apps#drive-a-desktop-app-yourself-hand-off)) | you let the app's agent work and press Enter; the checks, verify and heal then run as usual. Needs a terminal |
| `custom` | any command that reads the prompt on stdin | e.g. another agent CLI; write `{prompt_file}` in the command to pass the prompt file's path instead |
| `none` | nothing | a human does the coding; the tool prints the prompt |

### Choose an agent: installed or not

```bash
./scripts/sdlc agent
```

```text
AI agents (what drafts specs and writes code for you):
  *1  claude          Claude Code (claude -p)            not installed
                  install: npm install -g @anthropic-ai/claude-code
   2  codex           OpenAI Codex (codex exec)          installed     /usr/local/bin/codex
   3  gemini          Google Gemini CLI (gemini -p)      not installed
                  install: npm install -g @google/gemini-cli
   ...
   6  claude-desktop  Claude desktop engine (unattended) installed     /Users/you/Library/Application Support/Claude/claude-code/.../claude

  Desktop apps you drive (the tool opens the app and copies the instruction; you press Enter when the agent is done):
   7  handoff-claude  Claude desktop app (you drive it)  found         /Applications/Claude.app
   ...
   c  custom   any command that reads the prompt on stdin (or names the prompt file with {prompt_file})
   n  none     a human does the coding; the tool prints the prompt and waits
```

(The list is an example; the install lines come from each tool's own documentation.) In a terminal it then asks which to use. Your choice is saved in `.ai/agent.local.json`,
which is **not committed**: every developer on a team has different tools, so the project's default stays as generated and your machine uses what you picked.

| Command | Does |
|---|---|
| `./scripts/sdlc agent --list` | only list, never ask |
| `./scripts/sdlc agent codex` | use Codex on this machine (any name from the list, or `none`) |
| `./scripts/sdlc agent custom --command 'my-agent --prompt-stdin'` | use your own command |
| `./scripts/sdlc agent --reset` | forget your choice and use the project default again |
| `./scripts/sdlc spec requirements.pdf --agent gemini` | use that agent for this one run (a name or a full command) |

You can also choose an agent that is **not installed yet**: it is saved with the install line, and `./scripts/sdlc doctor` tells you when it is ready. If `spec` or `implement`
finds the agent missing, it shows this same list (and in a terminal asks) instead of only failing. Order of precedence: `--agent`, then `SDLC_AGENT_CMD`, then your saved choice, then the project default.

Check what is configured:

```bash
./scripts/sdlc doctor
```

The `agent` line shows the command and whether its program is installed, and the `pdf reader` line shows how PDFs will be read. For one run you can override the agent:
`SDLC_AGENT_CMD='your-agent-cli' ./scripts/sdlc spec requirements.pdf`.

> **Safety.** An agent runs shell commands in your project folder with your permissions (the `claude` preset pre-approves Bash so it can run the tests).
> Work on a git branch, read the diff before committing, and use a container or VM for documents you don't trust. The tool never commits or pushes; the agent is told not to.

## Step 1. Get a spec

The spec is two files in `.ai/specs/FEAT-001-<name>/`: `prd.md` (what is wanted, as numbered acceptance criteria) and `acceptance.json` (the checks that prove each criterion).
It is the contract: whatever it says is what gets built and what "done" means.

### Route A: from a document

You have a requirements document: a PDF, a Word file, Markdown or plain text.

```bash
./scripts/sdlc spec requirements.pdf --dry-run
```

```text
Dry run: nothing was executed or created.
  agent command : claude -p --permission-mode acceptEdits --allowedTools "Read" ...
  would create  : .ai/specs/FEAT-001-<feature name>/  (prd.md, acceptance.json, and a copy of the source in source/)
                  the folder is named after the feature in the PRD's title once the draft is valid; pass --name <slug> to choose it now
  prompt        : .ai/evidence/<run>/spec.prompt.md  (… lines, includes the document text)
```

Open the prompt: it contains the text the tool extracted from your document, plus the rules for writing the spec. When you are happy:

```bash
./scripts/sdlc spec requirements.pdf
```

What happens:

1. **Reading.** `.pdf`, `.docx`, `.md` and `.txt` are supported. For PDFs the tool uses `pdftotext` (poppler), `pypdf` or `mutool` if installed, and otherwise a basic built-in reader.
   A **scanned** PDF (a picture of text) has no text to read: the agent has to read the file itself, or you run OCR first.
2. **Guards.** The agent and a clean git tree are required, like `implement`. A finished PRD with the same name is never overwritten.
3. **Drafting.** The agent writes `prd.md` and `acceptance.json`, nothing else. If it writes any other file, the run stops (exit 4). If the document gives it nothing to work with, it writes questions instead of inventing a spec (exit 2).
4. **Validation.** The tool checks the draft is well-formed: every criterion has a check, every check cites a real criterion, check types are valid, `http` targets exist, no placeholders are left.
   Problems are sent back to the agent to fix, up to 3 attempts.
5. **Naming.** The folder is named after the *feature* the agent wrote in the PRD's title (`.ai/specs/FEAT-001-customer-login/`), not after the file (`requirements`).
   Pass `--name login` to choose the name yourself.
6. **A copy of your document** is saved in `.ai/specs/FEAT-001-customer-login/source/`, so the spec stays traceable to the version it came from.
   Running `spec` again on the same document finds this spec, and never overwrites it once the PRD is finished.

```text
  named the spec after the feature: .ai/specs/FEAT-001-customer-login/  (was FEAT-001-requirements; pass --name to choose another)

Draft ready: .ai/specs/FEAT-001-customer-login/
  6 acceptance criteria, 8 checks, 2 assumption(s) for you to confirm
This is a DRAFT written by an AI. Read it before anyone implements it (skill: .ai/skills/review-spec):
```

(The numbers above are an example.) Useful options: `--name login` to name the feature, `--focus "the login flow (section 3)"` to cover only part of a large document
(run `spec` once per feature), `--agent '...'` to use another agent for this run.

#### Review the draft (do not skip this)

The tool checks the draft's *form*. Only you can check its *meaning*. An agent can misread, invent, or drop a requirement, and everything built afterwards inherits that mistake.
Read `prd.md` and `acceptance.json` next to your document (skill `.ai/skills/review-spec` has the checklist):

- Each `AC-xxx` ends with `(Source: ...)`. Can you find that in the document, and does it say the same thing? Delete or fix any that don't.
- Is anything in the document missing from the criteria (or from the "Out of scope / not machine-verifiable" list, with a reason)?
- Numbers, status codes and wording: exactly as in the document?
- The last section lists every `ASSUMPTION:` the agent made and its open questions. Accept or change each assumption, answer each question, then delete the resolved lines.
- Would each check go red if the behaviour were wrong?
- Then change `Status: Draft (...)` to `Status: Accepted`, and re-check the form after your edits:

```bash
./scripts/sdlc facts --runtime none
```

### Route B: write it yourself

```bash
./scripts/sdlc new user-login
```

This creates `.ai/specs/FEAT-001-user-login/` with a `prd.md` and an `acceptance.json` full of placeholders. Until they are finished, `implement` refuses to run.

**The PRD (`prd.md`).** Replace the placeholders. Write the behaviour as **acceptance criteria**: one line each, observable from outside, including the unhappy paths.
The agent has to guess whatever you leave vague, and it is told to *stop and ask* rather than guess, so a clear PRD saves a round trip.

| ID | Behaviour |
|---|---|
| AC-001 | Right email + password -> `200` with `{"access_token": "...", "token_type": "bearer"}` |
| AC-002 | Wrong password -> `401` `{"detail": "Invalid email or password"}` |
| AC-003 | Unknown email -> the **same** `401` (never reveal which emails exist) |
| AC-004 | Malformed body (bad email, empty password) -> `422` |
| AC-005 | `GET /api/v1/auth/me` with a valid token -> `200` with the user's email |
| AC-006 | `/me` with no token, a malformed token, or an expired token -> `401` |

Also write the **out of scope** list (registration, refresh tokens, password reset, a users table, rate limiting). A project with a web or mobile app also needs a **UI & design** section and an **API integration** section in every PRD:
this feature has no screen and no screen calls it yet, so each is a single line, `No UI change.` and `No API calls.` (what to put in them for a feature with a screen that calls an API is in [Design and the UI](Design-and-the-UI) and [API Integration](API-Integration)). The full PRD is in the
[reference page](Reference-Login-Implementation#prdmd).

**The checks (`acceptance.json`).** Every acceptance criterion needs at least one **check**, and every check names the criterion it proves. Three kinds:

| Type | Use it to | Example here |
|---|---|---|
| `http` | call the running service and compare status/body | AC-001 to AC-004, and the "no token" cases of AC-006 |
| `cmd` | run one specific test | AC-005 and the "expired token" case of AC-006 |
| `file` | check a file exists or contains something | (not needed here) |

An `http` check is a single request, so it cannot reuse a token returned by an earlier request. That is why AC-005 uses a `cmd` check that runs a named test:
the agent must then write that test, with exactly that name.

```json
{
  "id": "CHK-002",
  "name": "Wrong password is rejected with a generic message",
  "covers": ["AC-002"],
  "type": "http",
  "target": "backend",
  "method": "POST",
  "path": "/api/v1/auth/login",
  "body": { "email": "demo@example.com", "password": "wrong-pass" },
  "expect": { "status": 401, "json": { "detail": "Invalid email or password" } }
}
```

The complete file is in the [reference](Reference-Login-Implementation#acceptancejson). Check the spec hangs together (needs no running system):

```bash
./scripts/sdlc facts --runtime none
```

If a criterion has no check you will see `AC-00x has no check: an unverified requirement is not done`.

## Step 2. Let the agent build it

Look at exactly what it will be given, without running anything:

```bash
./scripts/sdlc implement FEAT-001 --dry-run
```

```text
Dry run: nothing was executed.
  agent command : claude -p --permission-mode acceptEdits --allowedTools "Read" ...
  prompt        : .ai/evidence/<run>/implement.prompt.md  (176 lines, includes prd.md and acceptance.json)
```

Open the prompt file: it contains your PRD and your checks word for word, plus how the repository works and the rules. When you are happy:

```bash
./scripts/sdlc implement FEAT-001
```

### What happens

1. **Spec check.** Every criterion has a check, no `TODO(prd)` left. Otherwise it stops and tells you what is missing.
2. **Agent check.** The agent's program must be installed. Otherwise it tells you how to fix it.
3. **Clean tree.** Uncommitted changes outside the spec folder stop the run, so the diff you review is only the agent's work (`--allow-dirty` to override).
4. **Toolchain.** Missing virtualenv or `node_modules` are installed for you. No `setup` needed first.
5. **Baseline.** The gates run before the agent starts, so an existing failure is never blamed on the agent (`--skip-baseline` to skip).
6. **The agent works.** It writes tests first, then the code, adds any new library to `pyproject.toml` / `package.json` and installs it with `./scripts/sdlc sync`, adds new settings to `.env.example` and `docker-compose.yml`, and updates the API contract.
7. **Guard.** If the agent changed your spec or the verification machinery, the run stops (exit 4). If it wrote questions instead, you see them (exit 2).
8. **Dependencies.** Anything the agent added to a manifest but forgot to install is installed now.
9. **Verify and heal.** All gates, then your checks against the **running** service. Failures go back to the same agent, up to 5 rounds, stopping early if it makes no progress.
10. **Report.** You get the changed files and `.ai/evidence/latest/report.md`. Nothing is committed.

### When it stops

| Exit | Meaning | What you do |
|---|---|---|
| 0 | Implemented and verified | Review and ship (step 3) |
| 2 | Needs you: spec incomplete, agent missing, dirty tree, baseline red, or the agent has questions | Read the message; fix the spec or environment; run again |
| 3 | Same failure repeated; more rounds won't help | Read the report and the last heal prompt; fix it yourself or sharpen the spec |
| 4 | The agent changed your spec or the gate config | `git checkout -- <path>` to revert it, then run again |
| 1 | Verification still failing after all rounds | Read `.ai/evidence/latest/report.md` |

## Step 3. Review and ship

```bash
git status
```

```bash
git diff
```

Read it like any pull request: the tests, the code, the manifest change, the new settings, the contract diff (it should only add your endpoints and schemas).
Then:

```bash
git switch -c feat/FEAT-001-user-login
```

```bash
git add -A && git commit -m "feat(auth): login and /me (FEAT-001)"
```

Push and open a pull request. CI re-runs the same gates and the facts against the Docker stack and uploads the evidence report.

## Prefer to do the coding by hand? Or compare with the agent's work?

The [reference page](Reference-Login-Implementation) has the complete, verified code for this feature, written by hand following the same rules. Doing it manually looks like this:

1. Write the tests first (`backend/tests/test_auth.py`) and watch them fail.
2. Add the library to `backend/pyproject.toml`, then `./scripts/sdlc sync`.
3. Write the settings, the security helpers, the schemas and the two endpoints.
4. `./scripts/sdlc gates --keep-going`, and fix what it reports: line length (`ruff format .`), the OAuth2 `token_type` false alarm (a narrow, explained `noqa`), and contract drift.
5. Update the contract on purpose: `cd backend && python -m app.export_openapi --write ../.ai/contract/openapi.json`, and read the diff.
6. Add the three settings to `docker-compose.yml` and `.env.example` so the Docker stack has a demo user.
7. `./scripts/sdlc verify`:

```text
VERIFIED  29 passed, 0 failed, 1 warnings, 0 skipped
```

Try it by hand with `make up`, then:

```bash
curl -s -X POST localhost:8000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-pass"}'
```

```text
{"access_token": "eyJhbGciOiJIUzI1NiIsInR5...", "token_type": "bearer"}
```

```bash
curl -s localhost:8000/api/v1/auth/me -H "Authorization: Bearer <paste the access_token>"
```

```text
{"email":"demo@example.com"}
```

Without a token you get `401 {"detail":"Not authenticated"}`; a wrong password gets `401 {"detail":"Invalid email or password"}`. API docs: <http://localhost:8000/docs>. Stop with `make down`.

## What to change before real use

This sample is intentionally small. Before shipping real logins:

- Replace the single demo user with a **users table** and **hashed passwords** (argon2 or scrypt, never plain text).
- Add **rate limiting / lockout** on `/login`.
- Add **refresh tokens** and a logout story if you need sessions longer than 15 minutes.
- Serve only over **HTTPS**, keep `JWT_SECRET` in a secret manager or GitHub Environment secrets, and rotate it.
- Each of these is its own feature: put it in a requirements document (or write the spec), review, then `./scripts/sdlc implement`.

## Where to go next

- [The Verification Loop](The-Verification-Loop): how gates, facts, evidence and healing fit together.
- [Troubleshooting](Troubleshooting): when something doesn't behave as described here.
