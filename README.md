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

The web app has three pages, so nothing sends you to GitHub:

- **New project** (`/`): configure a stack, preview every generated file, download a zip.
- **Existing project** (`/existing`): an interactive guide to adding the `.ai/` setup to a repository you already have, with a command builder, the whole workflow step by step, and a live example of exactly what it writes.
- **Docs** (`/docs`): this README and every wiki page, with search and Copy buttons on every command. They are rendered from the markdown files at build time, and the build fails on a link that goes nowhere, so the in-app copy cannot drift from the repository.

The app is **light or dark**: it follows your system by default, and the switch in the header (sun, monitor, moon) overrides it. The choice is remembered in your browser, and the page is painted in the right theme from the first frame. The colors are theme tokens in `src/app/globals.css` (see `tailwind.config.ts`); tests check that the dark palette is exactly the original and that text meets WCAG AA contrast in light.

**CLI** (same engine, for automation and CI):

```bash
npm run scaffold -- init                                   # writes scaffolder.config.yaml
npm run scaffold -- generate --config scaffolder.config.yaml --out ../my-app
npm run scaffold -- generate --out ../api-only --set web.enabled=false --set database.type=none
npm run scaffold -- list                                   # what can be generated today
npm run scaffold -- adopt ../existing-repo [--write]       # add .ai/ to a repository that already exists (below)
```

**Without cloning**: the same commands run from npm ([`ai-scaffolder`](https://www.npmjs.com/package/ai-scaffolder), MIT), needing only Node 20+ and no account or login:

```bash
npx ai-scaffolder adopt ./my-repo --write
npx ai-scaffolder generate --config scaffolder.config.yaml --out ./my-app
```

**Then, in the generated project** (macOS, Ubuntu and WSL; on Windows PowerShell or cmd write `.\scripts\sdlc.cmd` instead of `./scripts/sdlc`):

```bash
cd ../my-app
./scripts/sdlc doctor     # toolchain ok?
./scripts/sdlc setup      # install dependencies
./scripts/sdlc verify     # gates + PRD facts: exactly what CI runs
```

**Build a feature from a requirements document (or from a spec you write):**

```bash
./scripts/sdlc spec requirements.pdf    # an agent drafts .ai/specs/FEAT-001-<feature>/{prd.md,acceptance.json} from the PDF; the tool validates the draft
# YOU REVIEW the draft: it is the contract, and an AI only drafted it (skill: .ai/skills/review-spec)
./scripts/sdlc implement FEAT-001        # an AI agent writes tests, code, dependencies, config and the API contract; the loop proves it
```

`spec` reads `.pdf`, `.docx`, `.md` and `.txt` (PDFs via `pdftotext`, `pypdf` or `mutool` if installed, otherwise a basic built-in reader; scanned PDFs need OCR). Each criterion cites its
source in the document, gaps are listed as assumptions for you to confirm, and nothing is built until you run `implement`. Prefer to write the two files yourself? `./scripts/sdlc new user-login`.

`implement` checks the spec is complete, installs the toolchain, runs a baseline, gives the agent your PRD and checks as its prompt, installs any
dependency the agent adds, then verifies against the running system and heals until green. It never commits or pushes. The project's default agent
(`claude`, `codex`, `gemini`, `copilot`, `cursor` or any command that reads a prompt on stdin) is set in the UI or `sdlc.agent.preset`; whoever runs the project
sees which agents are installed on their machine, with install lines for the rest, and picks one with `./scripts/sdlc agent`.

**Desktop apps, not just CLIs.** The agent can also be a desktop app. `./scripts/sdlc agent claude-desktop` runs the Claude Code that the **Claude desktop app** keeps for its Code tab, unattended, with no `claude` on `PATH` (and no stale one in the way).
`handoff-claude`, `handoff-cursor` and `handoff-vscode` open the Claude desktop app's Code tab, Cursor or VS Code on the project, put the instruction on your clipboard and wait for you to press Enter; the same checks, verification and healing then run.
See [Using a Desktop App](docs/wiki/Desktop-Apps.md).

Opening the generated folder in a desktop app (Claude Code, Codex) instead? In Claude Code just type `/sdlc` and pick a command (`/sdlc-doctor`, `/sdlc-setup`, `/sdlc-gates`, `/sdlc-verify`, `/sdlc-new`, `/sdlc-spec`, `/sdlc-implement FEAT-001`): the project ships them, and Claude does the work as the agent while `./scripts/sdlc` stays the judge. The generated README also has a guide, "Use it from an AI desktop app", with the same steps by hand for other apps, or to run the commands in the app's terminal for identical behaviour.

## Adopt an existing project

Already have a repository? Add the `.ai/` folder and the verification loop to it. Nothing is generated and your code, dependencies and CI are not touched:

```bash
npm run scaffold -- adopt ../my-repo            # dry run: what it found, which gates, which files it would write
npm run scaffold -- adopt ../my-repo --write    # writes .ai/ and one marked block in AGENTS.md; never overwrites a file of yours
cd ../my-repo && ./.ai/sdlc doctor && ./.ai/sdlc setup && ./.ai/sdlc baseline    # then commit .ai/ with baseline.json
./.ai/sdlc verify                                # from now on
```

The gates are your repository's own commands (npm/pnpm/yarn/bun scripts, ruff/mypy/pytest, Makefile targets), each with the place it was found; what it cannot detect is listed, never invented.
Existing code is rarely green, so "done" is **nothing that passed on adoption day fails now** (a baseline, per gate), plus every acceptance criterion of the feature. Gates that were already red show as known warnings; `baseline --tighten` locks in gains. Secrets already in the repository are recorded as known and only new ones fail.
`./.ai/sdlc onboard` has an agent draft a map of the code and its conventions (folding in any existing `CLAUDE.md` / `.cursor/rules`), then checks every path and command the draft cites against the repository; you review it. `spec` and `implement` work as above, with prompts that tell the agent to match the existing code and keep the diff small. See [Adopt an Existing Project](docs/wiki/Adopt-an-Existing-Project.md).

## Publishing the CLI

The repository's own `package.json` is `private` (it lists the web UI's dependencies), so the command-line tool is published as a separate, much smaller package built from it:

```bash
npm run build:cli                       # dist/cli: index.js (the whole CLI, templates and dependencies inside, ~0.75 MB), package.json, README, LICENSE
npx vitest run src/engine/__tests__/cli-package.test.ts   # packs it, installs the tarball in an empty folder and uses it from there
```

**Releasing (automated).** Push a version tag from `main`; `.github/workflows/release.yml` runs lint, types and every test, builds the package at that version and *stages* it on npm. Nothing is public until a maintainer approves it on npmjs.com (package, **Staged Packages** tab, **Approve**, with the passkey):

```bash
git tag v0.1.1 && git push origin v0.1.1
```

The workflow refuses a tag that is not `vMAJOR.MINOR.PATCH` (or `-rc.1` and the like, which go to the `next` tag, never `latest`) or that is not on `main`. It holds no npm token: it uses npm's trusted publishing (OIDC), whose identity can stage but cannot approve, and only the staging job can obtain it.

**One-time setup on npmjs.com** (package `ai-scaffolder` -> Settings -> Trusted Publisher -> GitHub Actions). The fields are case-sensitive, cannot be edited afterwards (delete and recreate), and npm only checks them when a release runs:

| Field | Value |
|---|---|
| Organization or user | `Blueray-Automation` |
| Repository | `Scaffolder` |
| Workflow filename | `release.yml` |
| Environment name | (leave empty) |
| Allowed actions | `npm stage publish` only; leave `npm publish` off |

Optionally, in the same settings page turn on "Require two-factor authentication and disallow tokens". The workflow has not run on GitHub yet: the first tag will show whether the trusted-publisher fields match.

**Releasing by hand** still works: `cd dist/cli && npm publish --access public` stages the version the same way (no `--otp`: a passkey is approved in the browser).

The package is `ai-scaffolder` (MIT); `0.1.0` was published on 2026-11-23 (by hand). npm *stages* a publish and holds it until a maintainer approves it with their 2FA: after `npm publish` open the package on npmjs.com, go to the **Staged Packages** tab and approve the version (publishing again meanwhile fails with `409 ... previously staged version`). A passkey is enough for 2FA; there is no `--otp` code. `npm publish --dry-run --access public` in `dist/cli` shows exactly what would be published (four files) without sending anything.
The bundle is checked not to contain the build machine's home folder, user name or paths. The package's `repository` field points at this GitHub repository (npm's trusted publishing needs it); the package has no `homepage`. npm generates provenance only for public repositories.

## Platforms

Generated projects run on **macOS**, **Ubuntu / other Linux** and **Windows** (natively with `scripts\sdlc.cmd`, or in WSL2). [Setup by Operating System](docs/wiki/Setup-by-Operating-System.md) lists what to install on each and how to run the tool there.
`npm run smoke` generates a project and drives it through the launcher for the OS it runs on (doctor, setup, every gate, the facts against real local processes); CI runs it on ubuntu, macOS and Windows.

## Documentation (wiki)

Step-by-step guides live in [`docs/wiki/`](docs/wiki/Home.md), are readable inside the web app (**Docs**, with search), and are published to the GitHub wiki automatically:

- **Setup by Operating System**: install the tools on macOS, Ubuntu or Windows
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
| **Verification loop** (`scripts/sdlc`) | stdlib-only Python: `implement` (spec to verified code via an agent), `sync` (dependencies), gates, **facts** (PRD acceptance criteria vs the *running* system), evidence reports, healing loop with budget, no-progress detection and an integrity guard that stops agents from editing the gates or specs |
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
cli/index.ts                the CLI (cli/adopt.ts: scan a folder, write the overlay)
scripts/bundle-docs.mjs     README.md + docs/wiki/*.md -> HTML for the app's /docs pages (src/docs*.generated.ts; runs with the template bundler)
src/app/, src/components/   the web app: `/` generator, `/existing` adopt guide (ExistingProject.tsx), `/docs` (DocsNav, DocsSearch, DocPageView)
packaging/, scripts/build-cli.mjs   the standalone `ai-scaffolder` npm package (one bundled file) and its README
src/engine/adopt/           adoption: detect.ts (what a repository defines), config.ts, generate.ts (the .ai/ overlay);
                            templates/adopt/ holds its files, and it reuses the runner from templates/core/
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

- Windows support was written without a Windows machine: its platform-specific logic is unit-tested by simulation, and `npm run smoke` on `windows-latest` in CI is the real check. The full `npm run e2e` (bash-based fake tools, Docker) is for macOS and Linux. Deploying from a Windows machine needs Git for Windows' bash or WSL (the generated `cd.yml` deploys from Linux).
- One full vertical slice: **FastAPI + Next.js (App Router) + PostgreSQL + GitHub Actions + GHCR**. Other stacks are planned.
- Adopting an existing repository: detection covers Node and Python projects and Makefiles (anything else goes in `gates.add`). It is tested on in-memory repositories and the generated runner is driven in throwaway git repositories (baseline, ratchet, secrets, `implement`, integrity), and `onboard` was run for real with the `claude` agent on scratch clones of this repository (its drafts passed the checks, and a planted false claim in `CLAUDE.md` was reported as a conflict). Not tested: a third-party repository, the other agent CLIs, or Windows. Creating a Python virtual environment and installing with pnpm, yarn, bun, Poetry or uv are generated and unit-tested, never executed. The baseline is per gate (no coverage or test-count ratchet yet) and there is no web UI for it yet.
- `spec` drafts are only as good as the document and the AI that reads it: the tool validates their form, a human must review their meaning. Scanned PDFs have no text to read.
- Agent presets: the whole pipeline around the agent (document reading included) is tested with a scripted agent. The `claude`, `codex`, `gemini`, `copilot` and `cursor` presets follow each tool's documented
  non-interactive mode but have **not been run against the real CLIs** (use `implement --dry-run` to inspect the command and prompt first).
  The desktop options are tested end to end with fakes (the hand-off in a real pseudo-terminal), and `claude-desktop` was also run once for real on macOS; nobody drove the Claude, Cursor or VS Code windows through a full `implement`, and the Windows and Linux locations are unverified.
- Deploy targets: `none` (placeholder, prints the plan) and `ssh-compose`. The tests exercise the image builds and the full
  compose stack (including PostgreSQL), and check the deploy scripts' syntax. They do **not** run the generated GitHub workflows,
  push to GHCR, or deploy to a real host; those are only checked structurally.
- The generated `web.audit` gate is advisory (`npm audit` reports transitive advisories with no patched release yet).
