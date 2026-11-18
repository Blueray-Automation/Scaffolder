# Getting Started

From a downloaded zip to a verified, running hello world.

## 1. Get a project

**Web UI:** run `npm install && npm run dev` in the Scaffolder repo, open <http://localhost:3000>, pick a starting point
(Full-stack, API + database, API only), adjust anything in the form, and press **Download `<name>.zip`**.
The **Config** button saves `scaffolder.config.yaml` so you can regenerate the same project later.

**CLI:**

```bash
npm run scaffold -- init
```

```bash
npm run scaffold -- generate --config scaffolder.config.yaml --out ../my-app
```

## 2. What you need installed

| Tool | Needed for | Version |
|---|---|---|
| `git` | the integrity guard, the secret scan, your sanity | any |
| `python3` | the `./scripts/sdlc` tooling, and the backend | tooling: 3.9+. Backend: the version in your config (default **3.12**). `setup` finds a suitable Python for the backend itself, and offers to install one if there is none |
| Node.js + npm | the web app (if you included it) | 22.12 or newer |
| Docker | the full stack and the facts stage | recent Docker Desktop / Engine with Compose v2 |

`./scripts/sdlc doctor` checks all of this for you.

## 3. Unzip and check

```bash
unzip hello-scaffold.zip && cd hello-scaffold
```

```bash
./scripts/sdlc doctor
```

If you see `permission denied`, the executable bit was lost by your unzip tool: run `chmod +x scripts/*` (or use `python3 scripts/sdlc.py <command>`).

## 4. Make it a git repository

```bash
git init && git add -A && git commit -m "chore: initial scaffold"
```

Several features need git: the secret scan lists files through it, the healing loop shows the agent what changed, and you will want
a clean baseline to see your own changes against.

## 5. Install and verify

```bash
./scripts/sdlc setup
```

This creates the backend virtualenv (`backend/.venv`) and installs the web dependencies.

```bash
./scripts/sdlc verify
```

You will see the stages run in order and end with:

```text
VERIFIED  20 passed, 0 failed, 1 warnings, 0 skipped
```

| Stage | What it proves |
|---|---|
| static | lint, formatting and type checks pass |
| unit | tests pass and coverage meets the floor (80% backend, 70% web by default) |
| build | the web app builds; `docker-compose.yml` is valid |
| contract | the API still matches the committed snapshot `.ai/contract/openapi.json` |
| facts | every requirement in the PRD holds on the **running** system (Docker) |
| security | no committed secrets; dependency audits |

The one warning is the advisory `npm audit` gate; see [Troubleshooting](Troubleshooting#npm-audit-shows-a-warning).
A full report is written to `.ai/evidence/latest/report.md`.

No Docker? `./scripts/sdlc verify --runtime local` starts the services as plain processes. Checks that need the database are reported as `SKIP`
(never as pass).

## 6. Run it

```bash
make up
```

- API: <http://localhost:8000/health> and the interactive docs at <http://localhost:8000/docs>
- Web: <http://localhost:3000> (shows the greeting fetched from the API)

```bash
make down
```

## 7. Find your way around

```
AGENTS.md          the entry point for any AI agent (and humans): rules, commands, hard constraints
.ai/
  specs/           one folder per feature: prd.md + acceptance.json  (FEAT-000 is a worked example)
  skills/          step-by-step playbooks (write-prd, implement-feature, fix-failing-gate, ...)
  rules/           conventions: testing, API contract, security, git, per-stack rules
  prompts/         what the loop sends to an agent
  contract/        committed API snapshot
  sdlc.json        configuration of the verification loop (generated; protected from agents)
scripts/sdlc       the verification loop
backend/ web/      the hello-world services
docker-compose.yml the whole stack
.github/workflows/ ci.yml and cd.yml
scaffolder.config.yaml   what this project was generated from
```

## Next

[Tutorial: Add a Login API](Tutorial-Add-a-Login-API): write a PRD and its checks, then `./scripts/sdlc implement` has an AI agent build and prove the feature
(you need an agent CLI installed once; `./scripts/sdlc doctor` shows what is configured).
