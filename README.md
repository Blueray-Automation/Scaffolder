# Scaffolder

Generate **AI-ready** full-stack projects where *"done" is proven, not claimed*.

Every generated project follows **PRD → Code → Test → Deploy**, ships a working hello world, and carries its own **verification loop**: it doesn't just run unit tests, it starts the real system and checks every requirement in the PRD against it. An AI agent (or you) then heals failures until everything is green.

```
   PRD (AC-001 ...)  ->  acceptance.json (checks)  ->  code + tests
         \                                                |
          \-------------- ./scripts/sdlc loop ------------+
              gates -> facts -> evidence -> heal -> verify again
```

## Quick start

Generate a project in the web UI (configure, preview every file, download a zip) or with the CLI:

```bash
npm install && npm run dev     # the web UI: http://localhost:3000
```

```bash
npx ai-scaffolder generate --out ./my-app     # the same engine on the command line (Node 20+, no account)
```

Then, in the generated project (on Windows PowerShell or cmd write `.\scripts\sdlc.cmd` instead of `./scripts/sdlc`):

```bash
cd my-app
./scripts/sdlc doctor      # is the toolchain installed?
./scripts/sdlc setup       # install dependencies
./scripts/sdlc verify      # gates + every PRD requirement checked against the running system: what CI runs
```

Already have a repository? Add the same loop without generating anything:

```bash
npx ai-scaffolder adopt ./my-repo --write
```

## Where to go next

| I want to | Read |
|---|---|
| Install the tools on macOS, Ubuntu or Windows | [Setup by Operating System](docs/wiki/Setup-by-Operating-System.md) |
| Go from a zip to a verified hello world | [Getting Started](docs/wiki/Getting-Started.md) |
| Pick a stack (Next.js, Nuxt, FastAPI, Flutter) and see what is generated | [Stacks and Options](docs/wiki/Stacks-and-Options.md) |
| Build a feature from a requirements document | [Tutorial: Add a Login API](docs/wiki/Tutorial-Add-a-Login-API.md) |
| Make the UI match a design (Figma, PDF or image) | [Design and the UI](docs/wiki/Design-and-the-UI.md) |
| Add the loop to a repository I already have | [Adopt an Existing Project](docs/wiki/Adopt-an-Existing-Project.md) |
| Use the Claude desktop app, Cursor or VS Code as the agent | [Using a Desktop App](docs/wiki/Desktop-Apps.md) |
| Understand gates, facts, evidence and healing | [The Verification Loop](docs/wiki/The-Verification-Loop.md) |
| Fix something that broke | [Troubleshooting](docs/wiki/Troubleshooting.md) |
| Know what has and has not been verified | [Status and Limits](docs/wiki/Status-and-Limits.md) |
| Work on Scaffolder itself, or release it | [Contributing and Releasing](docs/wiki/Contributing-and-Releasing.md) |

The same pages are inside the web app (**Docs**, with search) and published to the GitHub wiki. Edit `docs/wiki/`, not the wiki in the browser.

## What a generated project contains

| Area | Contents |
|---|---|
| **Hello world** | A FastAPI service and a Next.js or Nuxt page that shows its greeting, optionally a Flutter app too; strict linting and types, tests with enforced coverage floors |
| **AI operating system** (`.ai/`) | `AGENTS.md` for any agent, plus rules, skills, prompts and a worked PRD example |
| **Verification loop** (`scripts/sdlc`) | Gates, **facts** (PRD criteria against the running system), evidence reports, a healing loop with an integrity guard that stops agents from editing the checks |
| **Design** (`.ai/design/`) | Design tokens that the web and Flutter screens are generated from, a UI & design section in every PRD, and a gate against hard-coded values |
| **CI/CD and runtime** | GitHub Actions CI and CD (build images once, GHCR, staged environments, post-deploy checks), Dockerfiles, `docker-compose.yml` |

## Build a feature

```bash
./scripts/sdlc spec requirements.pdf    # an agent drafts the PRD and its checks from a document; YOU review the draft
./scripts/sdlc implement FEAT-001       # an agent writes tests and code; the loop proves it
```

Nothing is built until you run `implement`, and `implement` never commits or pushes. The agent can be a command-line tool (`claude`, `codex`, `gemini`, `copilot`, `cursor`, or any command that reads a prompt) or a desktop app; each person picks one for their machine with `./scripts/sdlc agent`.

## Design is a contract too

A project can pass every test and still not look like the design. So the design is committed like the API contract: one file of tokens (`.ai/design/tokens.json`) generates the stylesheet or the Dart theme, every PRD says what each screen looks like in every state, and a gate fails when a screen hard-codes a colour, space, radius or font size.

```bash
./scripts/sdlc design import mockups.pdf --feature FEAT-001   # a PDF, an image or a Figma link becomes reference images
./scripts/sdlc design check                                   # the gate: tokens valid, files current, nothing hard-coded
```

It does **not** compare pixels with your Figma frame; whether the screen looks like the design stays a review. Details: [Design and the UI](docs/wiki/Design-and-the-UI.md).

## Status

One full vertical slice is built and run for real: **FastAPI + Next.js + PostgreSQL + GitHub Actions + GHCR**, with **Nuxt 4** as the web framework in place of Next.js and a **Flutter** app on its own or beside the API. Generated projects are meant to run on macOS, Ubuntu and Windows; Windows support was written without a Windows machine, and the smoke run in CI is its real check.

Some things have never been run for real: the Figma import against Figma itself, the agent presets against the real CLIs, the generated GitHub workflows on GitHub, and third-party repositories with `adopt`. [Status and Limits](docs/wiki/Status-and-Limits.md) lists what was run and what was not.

MIT licensed. The command-line tool is published on npm as [`ai-scaffolder`](https://www.npmjs.com/package/ai-scaffolder).
