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

1. **[Getting Started](Getting-Started)**: download a project, run it, get a green `verify`.
2. **[Tutorial: Add a Login API](Tutorial-Add-a-Login-API)**: you write the PRD and the checks, run one command, and an AI agent builds and proves it.
3. **[The Verification Loop](The-Verification-Loop)**: how gates, facts, evidence and agent healing work.
4. **[Troubleshooting](Troubleshooting)**: common problems and fixes.
5. **[Reference: the login implementation](Reference-Login-Implementation)**: the complete, verified code for the tutorial.

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
