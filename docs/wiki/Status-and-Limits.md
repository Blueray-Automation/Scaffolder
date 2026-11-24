# Status and Limits

What was run for real, what was run against a stand-in, and what was not run at all, as of this version. If a claim is not on the left of a row, assume it was not run.

## Summary

| Area | Run for real | Not run |
|---|---|---|
| Generated projects | `npm test`: a matrix of 22 configurations (template tags, JSON, YAML, shell and Python syntax, CI-equals-local gate commands, PRD traceability). `npm run e2e`: Next.js + FastAPI, Nuxt, a Flutter app beside the API and on its own: installed, every gate run, the facts run against real processes | The Next.js project's Docker image build with the design tokens (image pulls hung on the machine used), a run on Windows |
| Docker and compose | Image builds and the full compose stack, PostgreSQL included, when a Docker daemon is running | |
| CI/CD | The workflow files are checked structurally | The generated GitHub workflows on GitHub, pushing to GHCR, deploying to a real host |
| Deploy targets | `none` (a placeholder that prints the plan) and `ssh-compose`, whose scripts are syntax-checked | A real deploy |
| Windows | Platform-specific logic is unit-tested by simulation; `npm run smoke` runs on `windows-latest` in CI | Nobody has run it on a Windows machine. The full `npm run e2e` (bash-based fake tools, Docker) is for macOS and Linux. Deploying from Windows needs Git for Windows' bash or WSL |
| Agents | The whole pipeline around the agent, document reading included, with a scripted agent | The `claude`, `codex`, `gemini`, `copilot` and `cursor` presets follow each tool's documented non-interactive mode but have not been run against the real CLIs. Use `implement --dry-run` to inspect the command and prompt first |
| Desktop apps | The hand-off in a real pseudo-terminal, with fakes; `claude-desktop` once for real on macOS | Anyone driving the Claude, Cursor or VS Code windows through a full `implement`; the Windows and Linux locations |
| `spec` drafts | The form of a draft is validated by the tool | The meaning: a draft is only as good as the document and the AI that reads it, so a human reviews it. Scanned PDFs have no text to read |
| Design contract | See below | See below |
| `adopt` | In-memory repositories; the generated runner in throwaway git repositories (baseline, ratchet, secrets, `implement`, integrity); `onboard` with the `claude` agent on scratch clones of this repository | Third-party repositories, the other agent CLIs, Windows. Creating a Python virtual environment and installing with pnpm, yarn, bun, Poetry or uv are generated and unit-tested, never executed |

## The design contract

**Run for real**

- The CSS and Dart generators were run with the generated projects' own `./scripts/sdlc design` and compared byte for byte with the ones the scaffolder writes.
- Every kind of hard-coded value in [Design and the UI](Design-and-the-UI#what-the-gate-checks) is a test that must fail the gate, and the values it must not flag are tests too.
- A generated Flutter app passed `flutter analyze --fatal-infos`, `dart format` and its tests with the real SDK.
- `npm run e2e` generated a Next.js, a Nuxt and a Flutter-only project, installed them and ran every gate and the facts, with a screen that cheats, an edited generated file and a changed token each failing the gate and `design sync` repairing them. The Nuxt run also built and ran its Docker images with the tokens in them.
- `design import`: images, and a PDF rendered by the real poppler (`pdftoppm`), were run for real, as were the checks that refuse a bad file or a missing renderer.

**Not run**

- **The Figma import has not been run against Figma.** It was run against a stand-in server written from Figma's documentation: the field names and the rate-limit headers follow the documented API, but nobody has run it with a real token and file, so expect to meet a difference the first time. If you try it, [Troubleshooting](Troubleshooting#design-import-for-a-figma-link-fails) says what to look at.
- Comparing screenshots with the reference images, importing HTML prototypes, and the design contract in `adopt`ed existing projects are not built.

## Things to know

- **One vertical slice.** FastAPI + Next.js (App Router) + PostgreSQL + GitHub Actions + GHCR, with Nuxt 4 in place of Next.js and Flutter 3.50 on its own or beside the API. Other stacks are planned: see [Stacks and Options](Stacks-and-Options).
- **`adopt` detection** covers Node and Python projects and Makefiles; anything else goes in `gates.add`. Its baseline is per gate: there is no coverage or test-count ratchet yet, and no web UI for it.
- **The generated `web.audit` gate is advisory.** `npm audit` reports transitive advisories with no patched release yet.
- **Facts report what they cannot run.** A check that needs something the current runtime does not have (the database with `--runtime local`) is `SKIP`, never a pass.

## How the docs stay honest

`npm test` checks every internal link and anchor in these pages and every `./scripts/sdlc` command they mention, so a command that does not exist cannot be documented. Whether a *claim* is true is a review: when you change what was run, change this page in the same pull request.
