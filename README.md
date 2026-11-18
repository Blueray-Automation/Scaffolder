# Scaffolder

Generate **AI-ready** full-stack projects where *"done" is proven, not claimed*.

Every generated project follows **PRD → Code → Test → Deploy**, ships a working hello world with everything
pre-configured, and carries its own **verification loop**: it doesn't just run unit tests, it starts the real
system and checks every requirement in the PRD against it, then lets an AI agent (or you) heal failures until green.

```
        PRD (AC-001 ...)  ->  acceptance.json (checks)  ->  code + tests
              \                                                 |
               \---------------- ./scripts/sdlc loop -----------+
                  gates:  static -> unit -> build -> contract -> facts -> security
                  fail -> evidence + heal prompt -> agent/you fix the CODE -> verify again
                  stops:  green | max iterations | same failure repeated | spec/gate files tampered with
```

## Use it

**Web UI** (configure, preview every file, download a zip):

```bash
npm install
npm run dev          # http://localhost:3000
```

**CLI** (same engine, for automation and CI):

```bash
npm run scaffold -- init                                   # writes scaffolder.config.yaml
npm run scaffold -- generate --config scaffolder.config.yaml --out ../my-app
npm run scaffold -- generate --out ../api-only --set web.enabled=false --set database.type=none
npm run scaffold -- list                                   # what can be generated today
```

**Then, in the generated project:**

```bash
cd ../my-app
./scripts/sdlc doctor     # toolchain ok?
./scripts/sdlc setup      # install dependencies
./scripts/sdlc verify     # gates + PRD facts: exactly what CI runs
```

## Documentation (wiki)

Step-by-step guides live in [`docs/wiki/`](docs/wiki/Home.md) and are published to the GitHub wiki automatically:

- **Getting Started**: from a downloaded zip to a verified, running hello world
- **Tutorial: Add a Login API**: change a generated project the way it is meant to be changed (PRD, checks, tests, code, proof), with the complete verified code
- **The Verification Loop** and **Troubleshooting** (every entry was hit for real)

The pages are reviewed in pull requests like code, and `npm test` checks every internal link, anchor and `./scripts/sdlc` command they mention.
**Edit `docs/wiki/`, not the wiki in the browser** (the next publish overwrites it).
One-time setup for publishing: enable *Wikis* in the repository settings and create the first page by hand
(GitHub only creates the wiki repository once it has a page); after that `.github/workflows/wiki.yml` takes over on every push to `main` that touches `docs/wiki/`.

## What gets generated (default: FastAPI + Next.js + PostgreSQL + GitHub Actions)

| Area | Contents |
|---|---|
| **Hello world** | FastAPI service (`/health`, `/ready`, `/api/v1/hello`), Next.js page that renders the greeting from the API at request time, typed settings, strict mypy/ruff/eslint, pytest and Vitest with enforced coverage floors |
| **AI operating system** (`.ai/`) | `rules/` (conventions), `skills/` (agent-neutral playbooks: write-prd, define-contract, implement-feature, write-tests, verify-loop, fix-failing-gate, review-change, release-and-deploy, write-fact-checks), `prompts/` (prd / implement / heal), `specs/` (FEAT-000 worked example + template), `contract/` (OpenAPI snapshot) |
| **Verification loop** (`scripts/sdlc`) | stdlib-only Python: gates, **facts** (PRD acceptance criteria vs the *running* system), evidence reports, healing loop with budget, no-progress detection and an integrity guard that stops agents from editing the gates or specs |
| **CI/CD** | `ci.yml` (per-component jobs + facts job, evidence artifact), `cd.yml` (CI gate → build images **once** → GHCR → staged environments → post-deploy facts), pluggable deploy targets, PR template, Dependabot |
| **Runtime** | Dockerfiles (non-root, health checks), `docker-compose.yml` with health-gated startup, `.env.example` |

`AGENTS.md` at the root of the generated project is the tool-neutral entry point for any agent.

### Why "facts" and not just tests

A PRD lists acceptance criteria (`AC-001` ...). `acceptance.json` maps each one to checks (`http`, `cmd`, `file`).
Verification **fails** if a criterion has no check, then starts the system and runs them. A check that cannot run in the
current runtime (e.g. database checks with `runtime: local`) is reported as `SKIP`, never as pass.
Post-deploy, the same facts run against the live URL.

## Everything is configurable

One typed config (`scaffolder.config.yaml`, validated, also editable in the UI) controls project identity, directory
layout, each component's framework/version/port, database, Docker, CI provider, CD environments/triggers/registry/deploy
target, and the loop itself: gates on/off, coverage floors, runtime mode (`docker` | `local` | `none`), iteration budget,
no-progress limit, fail-fast, agent command and timeout, extra protected paths. Anything can be overridden per run with
`--set path=value`. A copy of the config is written into each generated project.

Options without a pack yet (other languages/frameworks, mobile, MySQL/Mongo, Redis, auth providers, GitLab CI,
Kubernetes) are listed as *coming soon* and rejected by validation, rather than generating broken stubs.

## How it is built

```
templates/<pack>/...        real template files (*.tmpl), `<% %>` delimiters so ${{ }} and bash [[ ]] pass through
src/engine/                 pure TypeScript, no I/O: runs unchanged in the browser, the CLI and tests
  config.ts, capabilities.ts  typed config, validation, what is available
  gates.ts                    gate definitions: single source for .ai/sdlc.json AND the CI workflow
  generate.ts                 packs -> in-memory file list;   ci.ts / compose.ts / sdlcConfig.ts build YAML/JSON structurally
cli/index.ts                the CLI
src/components/             the web UI (config form, file explorer, zip download)
scripts/bundle-templates.mjs   templates/ -> src/engine/templates.generated.ts   (runs automatically before dev/build/test)
scripts/e2e-generated.ts       proof that generated projects work (below)
```

**Add a stack:** create `templates/<pack>/{service,repo}/`, add a `Pack` entry in `src/engine/generate.ts`, contribute its
gates in `gates.ts`, and flip `available: true` in `capabilities.ts`. The test matrix and `npm run e2e` then hold it to the
same standard.

## Verification of Scaffolder itself

```bash
npm run lint && npm run type-check && npm test && npm run build
npm run e2e       # slow, needs network, python3 >= 3.12 and node >= 22 on PATH
```

- `npm test`: matrix of 12 configurations, each checked for unresolved template tags, valid JSON/YAML, valid shell/Python
  syntax, CI-equals-local gate commands, PRD traceability, compose/CD/deploy consistency; plus validation and renderer tests.
- `npm run e2e`: generates real projects (default, backend-only without a database, custom directories), installs them,
  runs every gate, runs the facts against real processes and, when a Docker daemon is running, against the docker compose stack built from the generated Dockerfiles,
  then exercises the loop: heals a regression via a scripted agent, hands over to a human, stops on no progress, stops when
  an agent tampers with the spec or gate config, rejects a criterion without a check, catches a committed secret.
- `.github/workflows/ci.yml` runs all of the above.

## Limits (as of this version)

- One full vertical slice: **FastAPI + Next.js (App Router) + PostgreSQL + GitHub Actions + GHCR**. Other stacks are planned.
- Deploy targets: `none` (placeholder, prints the plan) and `ssh-compose`. The tests exercise the image builds and the full
  compose stack (including PostgreSQL), and check the deploy scripts' syntax. They do **not** run the generated GitHub workflows,
  push to GHCR, or deploy to a real host; those are only checked structurally.
- The generated `web.audit` gate is advisory (`npm audit` reports transitive advisories with no patched release yet).
