# Stacks and Options

What you can generate, what is in it, and what you can change.

## What gets generated

The default is FastAPI + Next.js + PostgreSQL + GitHub Actions.

| Area | Contents |
|---|---|
| **Hello world** | A FastAPI service (`/health`, `/ready`, `/api/v1/hello`), a Next.js page (or Nuxt 4) that renders the greeting from the API at request time, an optional Flutter app that shows it too, typed settings, strict mypy/ruff/eslint, pytest and Vitest with enforced coverage floors |
| **AI operating system** (`.ai/`) | `rules/` (conventions), `skills/` (agent-neutral playbooks: write-prd, define-contract, implement-feature, implement-ui, write-tests, verify-loop, fix-failing-gate, review-change, release-and-deploy, write-fact-checks), `prompts/` (prd / implement / heal), `specs/` (FEAT-000 worked example and a template), `contract/` (OpenAPI snapshot), `design/` (design tokens) |
| **Verification loop** (`scripts/sdlc`) | Standard-library Python: `implement` (spec to verified code via an agent), `sync` (dependencies), gates, **facts** (PRD acceptance criteria against the *running* system), evidence reports, a healing loop with a budget, no-progress detection, and an integrity guard that stops agents from editing the gates or specs |
| **CI/CD** | `ci.yml` (a job per component and a facts job, evidence as an artifact), `cd.yml` (CI gate, build images **once**, GHCR, staged environments, post-deploy facts), pluggable deploy targets, a PR template, Dependabot |
| **Runtime** | Dockerfiles (non-root, health checks), `docker-compose.yml` with health-gated startup, `.env.example` |

`AGENTS.md` at the root of the project is the tool-neutral entry point for any agent.

## Pick a stack

In the web UI the starting points are tabs under **Start from**. On the command line, use `--set` for anything in the form.

| Start from | You get | CLI |
|---|---|---|
| **Full-stack** | FastAPI + Next.js + PostgreSQL | the default |
| **API + database** | FastAPI + PostgreSQL | `--set web.enabled=false` |
| **API only** | FastAPI | `--set web.enabled=false --set database.type=none` |
| **Next.js** or **Nuxt** | a web app on its own, with no separate API | `--set backend.enabled=false --set database.type=none` (plus `--set web.framework=nuxt` for Nuxt) |
| **Flutter** | a mobile app on its own | `--set backend.enabled=false --set web.enabled=false --set database.type=none --set mobile.enabled=true` |

Full-stack uses Next.js. To put **Nuxt 4** in front of the API instead, change **Web app → Framework** to Nuxt (`--set web.framework=nuxt`). To add a **Flutter** app to a stack that has a backend, tick **Mobile app** (`--set mobile.enabled=true`).
**Android** and **iOS** (native) are marked *soon*: they have no pack yet, so they cannot be chosen rather than being generated as broken stubs.

Every stack with a screen (a web app, a Flutter app, or both) also gets the design tokens and the gate that checks them: see [Design and the UI](Design-and-the-UI).
It also gets a place for the documentation of the API it calls, and a PRD section that may only name documented operations: see [API Integration](API-Integration).

## A Flutter app

It needs the Flutter SDK on the machine (`./scripts/sdlc doctor` says so); the version is `mobile.version` (`3.50`, the only line the pack has been run against). With a backend the app shows the greeting from the API through a typed client.

- **Gates** (`mobile.analyze`, `mobile.unit`, `mobile.build`): `flutter analyze --fatal-infos` plus `dart format`, `flutter test --coverage` with an enforced floor (a library file that no test loads counts as a failure, which `flutter test --coverage` alone would hide), and `flutter build bundle`, a compile that needs nothing but the SDK.
- **Facts**: a phone has no URL to call, so each acceptance criterion runs a test *by name* (`flutter test ... --plain-name "AC-002"`; a name that matches nothing fails, and so does a skipped test). Next to a backend, one more check runs the app's own client against the live API.
- **What it does not do**: no `android/` or `ios/` folders (their contents change with every Flutter release; one `flutter create` writes the current ones, and the generated files are left alone), no APK or iOS build (that needs the Android SDK or Xcode), no dependency audit gate (the Dart SDK has none), no store release. A project with only a mobile app has nothing to put in a container, so Docker and CD are left out.

## Change anything

One typed config, `scaffolder.config.yaml`, is validated and also editable in the UI (the **Config** button saves it). It controls:

- project identity and directory layout;
- each component's framework, version and port, the database, Docker and the CI provider;
- CD environments, triggers, registry and deploy target;
- the design contract: `design.enforce`, `design.tool` and `design.url`;
- the API documentation contract: `api.enforce`;
- the loop itself: gates on or off, coverage floors, runtime mode (`docker`, `local` or `none`), the iteration budget, the no-progress limit, fail-fast, the agent command and its timeout, and extra protected paths.

Anything can be overridden for one run with `--set path=value`, and a copy of the config is written into each generated project, so you can regenerate the same project later.

Options without a pack yet (other languages and frameworks, mobile frameworks other than Flutter, MySQL and Mongo, Redis, auth providers, GitLab CI, Kubernetes) are listed as *coming soon* and rejected by validation, rather than generating broken stubs.

## Next

[Getting Started](Getting-Started) takes a generated project to a green `verify`.
