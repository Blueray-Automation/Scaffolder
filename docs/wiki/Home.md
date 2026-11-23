# Scaffolder

Scaffolder generates **AI-ready** full-stack projects where *"done" is proven, not claimed*.

Every generated project follows **PRD -> Code -> Test -> Deploy**, ships a working hello world with everything pre-configured,
and carries a **verification loop**: it doesn't just run unit tests, it starts the real system and checks every requirement in the PRD against it,
then lets an AI agent (or you) heal failures until everything is green.

```
   PRD (AC-001 ...)  ->  acceptance.json (checks)  ->  code + tests
         \                                                |
          \-------------- ./scripts/sdlc loop ------------+
              gates -> facts -> evidence -> heal -> verify again
```

## Start here

1. **[Setup by Operating System](Setup-by-Operating-System)**: install the tools on macOS, Ubuntu or Windows (native or WSL2).
2. **[Getting Started](Getting-Started)**: download a project, run it, get a green `verify`.
3. **[Tutorial: Add a Login API](Tutorial-Add-a-Login-API)**: start from a requirements document (PDF, Word, Markdown), review the spec an agent drafts, and let an agent build and prove it.
4. **[The Verification Loop](The-Verification-Loop)**: how gates, facts, evidence and agent healing work.
5. **[Troubleshooting](Troubleshooting)**: common problems and fixes.
6. **[Reference: the login implementation](Reference-Login-Implementation)**: the complete, verified code for the tutorial.
7. **[Using a Desktop App](Desktop-Apps)**: let the Claude desktop app, Cursor or VS Code be the AI agent instead of a command-line tool.
8. **[Adopt an Existing Project](Adopt-an-Existing-Project)**: already have a repository? Add the `.ai/` folder and the verification loop to it, judged against a baseline instead of "everything green".

## What you get

| Area | Contents |
|---|---|
| Hello world | FastAPI service (`/health`, `/ready`, `/api/v1/hello`) and a Next.js page that shows the greeting from the API |
| Quality gates | ruff, mypy, eslint, tsc, pytest and Vitest with enforced coverage floors, API contract drift check, secret scan |
| AI operating system | `AGENTS.md`, rules, skills, prompts and a worked PRD example, tool-neutral |
| Verification loop | `./scripts/sdlc`: gates, facts against the running system, evidence reports, a healing loop with an integrity guard |
| CI/CD | GitHub Actions CI and CD (build images once, GHCR, staged environments, post-deploy checks), Docker, compose |

## About this wiki

These pages live in the repository under `docs/wiki/` and are published to the GitHub wiki automatically
whenever they change on `main` (see `.github/workflows/wiki.yml`). **Edit the files in `docs/wiki/`, not the wiki pages in the browser**: browser edits are overwritten on the next publish.
