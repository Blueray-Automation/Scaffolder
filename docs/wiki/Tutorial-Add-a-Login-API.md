# Tutorial: Add a Login API

You write **two files**: `prd.md` (what you want) and `acceptance.json` (how to prove it). One command does everything else:
the tests, the code, the new dependencies, the config, the API contract, and the proof that it all works.

```
you:      ./scripts/sdlc new user-login          creates the spec folder
you:      write prd.md + acceptance.json         the only manual part
you:      ./scripts/sdlc implement FEAT-001      <- everything below happens by itself
 tool:      checks the spec is complete, installs the toolchain, runs a baseline
 agent:     reads YOUR spec as its prompt; writes tests, code, dependencies, config, contract
 tool:      installs the dependencies the agent added, then verifies against the running system
 loop:      failures go back to the agent to fix, until green (or it stops and asks you)
you:      git diff, commit, push, PR             nothing is committed for you
```

> **How much was tested.** The whole pipeline around the agent (spec check, baseline, prompt, dependency install, integrity guard,
> questions, verification) is tested end to end with a *scripted* agent that does what a good AI is told to do. The `claude` and `codex`
> presets follow each tool's documented non-interactive mode but have **not been run against the real tools**. Run `--dry-run` first (below) and expect to tune your first prompt.

## Before you start (once)

1. A project from [Getting Started](Getting-Started) that passes `./scripts/sdlc verify`.
2. An **AI agent CLI**, installed and signed in. Choose which in the web UI (**Verification loop -> AI agent**) or `sdlc.agent.preset` in `scaffolder.config.yaml`:

| Preset | Runs | Notes |
|---|---|---|
| `claude` (default) | `claude -p ...` ([headless mode docs](https://code.claude.com/docs/en/headless)) | needs the Claude Code CLI on your `PATH` |
| `codex` | `codex exec --sandbox workspace-write -` ([docs](https://developers.openai.com/codex/noninteractive)) | needs the Codex CLI; its sandbox may block network, which is why dependencies are installed by the tool, not the agent |
| `custom` | any command that reads the prompt on stdin | e.g. another agent CLI |
| `none` | nothing | a human does the coding; the tool prints the prompt |

Check what is configured:

```bash
./scripts/sdlc doctor
```

The `agent` line shows the command and whether its program is installed. For one run you can override it:
`SDLC_AGENT_CMD='your-agent-cli' ./scripts/sdlc implement FEAT-001`.

> **Safety.** An agent runs shell commands in your project folder with your permissions (the `claude` preset pre-approves Bash so it can run the tests).
> Work on a git branch, read the diff before committing, and use a container or VM for specs you don't trust. The tool never commits or pushes; the agent is told not to.

## Step 1. Create the spec

```bash
./scripts/sdlc new user-login
```

This creates `.ai/specs/FEAT-001-user-login/` with a `prd.md` and an `acceptance.json` full of placeholders.

## Step 2. Write the PRD (`prd.md`)

Replace the placeholders. Write the behaviour as **acceptance criteria**: one line each, observable from outside, including the unhappy paths.
The agent has to guess whatever you leave vague, and it is told to *stop and ask* rather than guess, so a clear PRD saves a round trip.

| ID | Behaviour |
|---|---|
| AC-001 | Right email + password -> `200` with `{"access_token": "...", "token_type": "bearer"}` |
| AC-002 | Wrong password -> `401` `{"detail": "Invalid email or password"}` |
| AC-003 | Unknown email -> the **same** `401` (never reveal which emails exist) |
| AC-004 | Malformed body (bad email, empty password) -> `422` |
| AC-005 | `GET /api/v1/auth/me` with a valid token -> `200` with the user's email |
| AC-006 | `/me` with no token, a malformed token, or an expired token -> `401` |

Also write the **out of scope** list (registration, refresh tokens, password reset, a users table, rate limiting). The full PRD is in the
[reference page](Reference-Login-Implementation#prdmd).

## Step 3. Say how each criterion is proven (`acceptance.json`)

Every acceptance criterion needs at least one **check**, and every check names the criterion it proves. Three kinds:

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

## Step 4. Let the agent build it

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
| 0 | Implemented and verified | Review and ship (step 5) |
| 2 | Needs you: spec incomplete, agent missing, dirty tree, baseline red, or the agent has questions | Read the message; fix the spec or environment; run again |
| 3 | Same failure repeated; more rounds won't help | Read the report and the last heal prompt; fix it yourself or sharpen the PRD |
| 4 | The agent changed your spec or the gate config | `git checkout -- <path>` to revert it, then run again |
| 1 | Verification still failing after all rounds | Read `.ai/evidence/latest/report.md` |

## Step 5. Review and ship

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

## Prefer to do it by hand? Or compare with the agent's work?

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
- Each of these is its own feature: write a PRD and checks, then `./scripts/sdlc implement`.

## Where to go next

- [The Verification Loop](The-Verification-Loop): how gates, facts, evidence and healing fit together.
- [Troubleshooting](Troubleshooting): when something doesn't behave as described here.
