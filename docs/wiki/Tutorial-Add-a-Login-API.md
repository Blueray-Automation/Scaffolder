# Tutorial: Add a Login API

Build a small login feature (`POST /api/v1/auth/login` and `GET /api/v1/auth/me`) in a project you downloaded from Scaffolder,
the way the project is designed to be changed: **requirements first, tests next, code last, and proof at the end.**

- **Time:** about 30 minutes by hand, less with an AI agent.
- **You need:** a project from [Getting Started](Getting-Started) that already passes `./scripts/sdlc verify`.
- **Everything here was run for real.** The code is in [Reference: the login implementation](Reference-Login-Implementation) and
  finished with `VERIFIED  29 passed, 0 failed` including the login checks against the Docker stack.

> Scaffolder's own JWT/auth option is "coming soon", so login is built by hand. That makes it a good first exercise.

## The big picture

```
1. Create the spec        ./scripts/sdlc new user-login
2. Write the PRD          what "done" means, as numbered acceptance criteria (AC-001 ...)
3. Write the checks       acceptance.json: how each criterion is proven
4. Write tests first      watch them fail
5. Write the code         make them pass
6. Run the gates          fix what the checks tell you
7. verify                 green = done, with a report as evidence
8. Commit, push, PR       CI runs the same checks
```

## Step 1. Create the spec

```bash
./scripts/sdlc new user-login
```

This creates `.ai/specs/FEAT-001-user-login/` with a `prd.md` and an `acceptance.json` full of placeholders.

Run the facts now and watch it refuse:

```bash
./scripts/sdlc facts --runtime none
```

```text
  FAIL  FEAT-001:traceability  ... prd.md still contains TODO(prd) placeholders: the PRD is not finished
NOT VERIFIED
```

That is on purpose: a half-written requirement cannot pass.

## Step 2. Write the PRD

Open `.ai/specs/FEAT-001-user-login/prd.md`, replace the placeholders, and write the behaviour as **acceptance criteria**:
one line each, observable from outside, including the unhappy paths.

| ID | Behaviour |
|---|---|
| AC-001 | Right email + password -> `200` with `{"access_token": "...", "token_type": "bearer"}` |
| AC-002 | Wrong password -> `401` `{"detail": "Invalid email or password"}` |
| AC-003 | Unknown email -> the **same** `401` (never reveal which emails exist) |
| AC-004 | Malformed body (bad email, empty password) -> `422` |
| AC-005 | `GET /api/v1/auth/me` with a valid token -> `200` with the user's email |
| AC-006 | `/me` with no token, a malformed token, or an expired token -> `401` |

Also write down what is **out of scope** (registration, refresh tokens, password reset, a users table, rate limiting). The full PRD is in
the [reference page](Reference-Login-Implementation#prdmd).

## Step 3. Say how each criterion is proven

Open `acceptance.json`. Every acceptance criterion needs at least one **check**, and every check must name the criterion it proves.
There are three kinds of checks:

| Type | Use it to | Example here |
|---|---|---|
| `http` | call the running service and compare status/body | AC-001 to AC-004, and the "no token" cases of AC-006 |
| `cmd` | run one specific test | AC-005 and the "expired token" case of AC-006 |
| `file` | check a file exists or contains something | (not needed here) |

Why `cmd` for AC-005? An `http` check is a single request, so it cannot take the token returned by one request and use it in the next.
A pytest test can, so the check runs that test.

Skeleton of one check (the full file is in the [reference](Reference-Login-Implementation#acceptancejson)):

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

Check it hangs together (this needs no running system):

```bash
./scripts/sdlc facts --runtime none
```

The traceability line for `FEAT-001` should now say `PASS`. If a criterion has no check you will see `AC-00x has no check: an unverified requirement is not done`.

## Step 4. Write the tests first

Create `backend/tests/test_auth.py` (the complete file is in the [reference](Reference-Login-Implementation#8-tests-backendteststest_authpy-new)).
It covers every criterion, plus the edge cases a PRD is easy to forget: a token signed with another key, a token with no subject,
no demo user configured.

Run it and **watch it fail**; a test you never saw fail proves nothing:

```bash
cd backend && .venv/bin/pytest -q tests/test_auth.py
```

At this point it stops at an import error, because the code doesn't exist yet.

## Step 5. Write the code

Add the pieces from the [reference page](Reference-Login-Implementation), in this order:

1. `pyjwt` in `backend/pyproject.toml`, then reinstall.
2. Settings: `JWT_SECRET`, `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD` (no defaults, and a strong key is required).
3. `app/core/security.py`: constant-time credential check, create/decode token.
4. `app/schemas/auth.py`: the request and response models (the contract lives here).
5. `app/api/v1/auth.py`: the two endpoints, then register the router.

Now the tests go green:

```bash
cd backend && .venv/bin/pytest -q tests/test_auth.py
```

```text
18 passed
```

### Prefer to let an AI agent do steps 4 and 5?

Open the project folder in your AI coding tool and give it this prompt:

```text
Read AGENTS.md. Implement FEAT-001 (the spec is in .ai/specs/FEAT-001-user-login/) following
.ai/skills/implement-feature and .ai/skills/write-tests. Write tests first.
You are done only when ./scripts/sdlc verify exits 0. Do not edit .ai/sdlc.json, scripts/sdlc*,
.github/workflows/ or anything under .ai/specs/.
```

Or let the loop drive the agent for you. Give it a command that reads a prompt on stdin (this depends on your tool):

```bash
SDLC_AGENT_CMD='your-agent-cli' ./scripts/sdlc feature FEAT-001
```

The loop runs the checks, sends failures to the agent as a "fix this" note, and checks again, up to 5 times. See [The Verification Loop](The-Verification-Loop).

## Step 6. Run the gates and fix what they tell you

```bash
./scripts/sdlc gates --keep-going
```

`--keep-going` shows every failure at once instead of stopping at the first failing stage. On the first run of this feature you should expect **three** things:

| What you see | Why | What to do |
|---|---|---|
| `backend.lint` fails on line length / formatting | Your editor didn't format like ruff | `cd backend && .venv/bin/ruff format .`, then re-run |
| `backend.lint`: `S105 hardcoded password ... "token_type"` | A false alarm: `token_type = "bearer"` is the OAuth2 token type, not a password | Add a **narrow, explained** `# noqa: S105 (the OAuth2 token type, not a password)` on that line only |
| `backend.contract` fails with a diff | You added endpoints, so the API changed. The gate exists to make that deliberate | Step 7 |

Rules of thumb: fix the code, not the check. A `noqa` is fine for a *proven false alarm*, one line, with the reason written next to it.
Never lower a threshold, skip a test, or delete a check to get green.

## Step 7. Update the API contract (on purpose)

The committed file `.ai/contract/openapi.json` is a snapshot of your API. Changing the API without updating it fails the gate, so the change is always visible in review.
Regenerate it and **read the diff**:

```bash
cd backend && python -m app.export_openapi --write ../.ai/contract/openapi.json
```

The diff should add `/api/v1/auth/login`, `/api/v1/auth/me` and the schemas `LoginRequest`, `TokenResponse`, `MeResponse`, and nothing else.

## Step 8. Give Docker the demo user, then verify

The Docker stack is what the facts run against, so the container needs the demo user and a signing key.
Add three lines under `backend` -> `environment` in `docker-compose.yml` and the same names in `.env.example`
(the exact lines are in the [reference](Reference-Login-Implementation#9-environment-for-docker)). These are **development values only**.

Make sure Docker is running, then:

```bash
./scripts/sdlc verify
```

```text
== facts ==
  PASS  FEAT-001:traceability  FEAT-001 every criterion has a check
  PASS  FEAT-001:CHK-001  Valid credentials return a bearer token
  PASS  FEAT-001:CHK-002  Wrong password is rejected with a generic message
  ...
VERIFIED  29 passed, 0 failed, 1 warnings, 0 skipped
```

The one warning is the advisory `npm audit` gate (see [Troubleshooting](Troubleshooting#npm-audit-shows-a-warning)).
The report with every AC and the check that proves it is `.ai/evidence/latest/report.md`.

No Docker? `./scripts/sdlc verify --runtime local` works, but runs the service without a demo user, so the login checks cannot pass there. Use Docker for this feature.

## Step 9. Try it by hand

```bash
make up
```

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

Without a token you get `401 {"detail":"Not authenticated"}` with a `www-authenticate: Bearer` header; a wrong password gets
`401 {"detail":"Invalid email or password"}`. The interactive API docs are at <http://localhost:8000/docs>. Stop everything with:

```bash
make down
```

## Step 10. Commit, push, open a PR

```bash
git switch -c feat/FEAT-001-user-login
```

```bash
git add -A && git commit -m "feat(auth): add demo login and /me (FEAT-001)"
```

Push the branch and open a pull request. The PR template asks for the report summary. CI re-runs the same gates and the facts
against the Docker stack, and uploads the evidence report as an artifact.

## What to change before real use

This sample is intentionally small. Before shipping real logins:

- Replace the single demo user with a **users table** (see the PostgreSQL setup in the project) and **hashed passwords** (argon2 or scrypt, never plain text).
- Add **rate limiting / lockout** on `/login`.
- Add **refresh tokens** and a logout story if you need sessions longer than 15 minutes.
- Serve only over **HTTPS**, keep `JWT_SECRET` in a secret manager or GitHub Environment secrets, and rotate it.
- Write a new PRD for each of these. Each one is its own feature: `./scripts/sdlc new <name>`.

## Where to go next

- [The Verification Loop](The-Verification-Loop): how gates, facts, evidence and healing fit together.
- [Troubleshooting](Troubleshooting): when something doesn't behave as described here.
