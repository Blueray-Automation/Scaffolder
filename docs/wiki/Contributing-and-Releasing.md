# Contributing and Releasing

For people working on Scaffolder itself: how it is built, how to add a stack, how it is checked, and how a version reaches npm.

## How it is built

```
templates/<pack>/...        real template files (*.tmpl), `<% %>` delimiters so ${{ }} and bash [[ ]] pass through
src/engine/                 pure TypeScript, no I/O: runs unchanged in the browser, the CLI and tests
  config.ts, capabilities.ts  typed config, validation, what is available
  gates.ts                    gate definitions: single source for .ai/sdlc.json AND the CI workflow
  generate.ts                 packs -> in-memory file list;   ci.ts / compose.ts / sdlcConfig.ts build YAML/JSON structurally
  design.ts                   design tokens: validation and the CSS and Dart generators (the Python twin is in sdlc.py.tmpl)
  adopt/                      adoption: detect.ts (what a repository defines), config.ts, generate.ts (the .ai/ overlay)
cli/index.ts                the CLI (cli/adopt.ts: scan a folder, write the overlay)
src/app/, src/components/   the web app: `/` generator, `/existing` adopt guide, `/docs` (DocsNav, DocsSearch, DocPageView)
scripts/bundle-templates.mjs   templates/ -> src/engine/templates.generated.ts   (runs automatically before dev/build/test)
scripts/bundle-docs.mjs        README.md + docs/wiki/*.md -> HTML for the app's /docs pages (src/docs*.generated.ts)
scripts/e2e-generated.ts       proof that generated projects work (below)
packaging/, scripts/build-cli.mjs   the standalone `ai-scaffolder` npm package (one bundled file) and its README
templates/adopt/            the files `adopt` writes; it reuses the runner from templates/core/
```

Two things to know before changing anything:

- The design generators exist twice, in TypeScript (`src/engine/design.ts`, which writes the first files) and in Python (the `design sync` command in `templates/core/scripts/sdlc.py.tmpl`). They must produce identical bytes; `design.test.ts` runs both. Change both together.
- `sdlc.py.tmpl` also ships into adopted repositories, so it must run on Python 3.9, must not name Flutter, and must write the launcher's folder as `<%sdlcDir%>` rather than `scripts/sdlc`. The tests check these.

## Add a stack

Create `templates/<pack>/{service,repo}/`, add a `Pack` entry in `src/engine/generate.ts`, contribute its gates in `gates.ts`, and flip `available: true` in `capabilities.ts`.

- A **web framework** also gets an entry in `src/engine/webStacks.ts`: gate labels, build environment, how the facts stage starts it, and where its design tokens go.
- A **mobile framework** gets one in `src/engine/mobileStacks.ts`: its commands, setup step, versions, the project names its tooling refuses, and its design tokens file.

The test matrix and `npm run e2e` then hold it to the same standard.

## Check your change

```bash
npm run lint && npm run type-check && npm test && npm run build
```

```bash
npm run e2e      # slow: needs network, python3 >= 3.12 and node >= 22 on PATH (the flutter-* scenarios need the Flutter SDK)
```

- `npm test`: a matrix of 22 configurations, each checked for unresolved template tags, valid JSON and YAML, valid shell and Python syntax, CI-equals-local gate commands, PRD traceability and compose/CD/deploy consistency; plus validation, renderer and documentation tests.
- `npm run e2e`: generates real projects (default, backend-only without a database, custom directories, Nuxt in place of Next.js, a Flutter app beside the API, a Flutter app on its own), installs them, runs every gate, runs the facts against real processes and, when a Docker daemon is running, against the compose stack built from the generated Dockerfiles. Then it exercises the loop: heals a regression via a scripted agent, hands over to a human, stops on no progress, stops when an agent tampers with the spec or gate config, rejects a criterion without a check, catches a committed secret, and fails the design gate for a screen that cheats.
- `npm run smoke`: generates a project and drives it through the launcher for the OS it runs on (doctor, setup, every gate, the facts against real local processes). CI runs it on ubuntu, macOS and Windows.
- `.github/workflows/ci.yml` runs all of the above.

## The documentation

The pages live in [`docs/wiki/`](https://github.com/Blueray-Automation/Scaffolder/tree/main/docs/wiki) and the README at the root.

- **One home for each fact.** The README is the front door and only points to pages; a page explains one thing. If you are about to copy a paragraph from one page to another, link to it instead.
- **The sidebar is the table of contents.** `docs/wiki/_Sidebar.md` lists every page under a group heading (a bold line); the web app's navigation is built from it, so a new page must be listed there. Add the page's one-line description to the table on `Home`.
- **Rendered at build time.** `scripts/bundle-docs.mjs` turns the README and the pages into the app's **Docs**. The build fails on a link that goes nowhere, and `npm test` checks every internal link and anchor and every `./scripts/sdlc` command a page mentions.
- **Edit `docs/wiki/`, not the wiki in the browser.** `.github/workflows/wiki.yml` publishes the folder to the GitHub wiki on every push to `main` that touches it, and the next publish overwrites browser edits. One-time setup: enable *Wikis* in the repository settings and create the first page by hand (GitHub only creates the wiki repository once it has a page).

## The web app's theme

The app is light or dark: it follows the system by default, and the switch in the header (sun, monitor, moon) overrides it. The choice is remembered in the browser, and the page is painted in the right theme from the first frame. The colours are theme tokens in `src/app/globals.css` (see `tailwind.config.ts`); tests check that the dark palette is exactly the original and that text meets WCAG AA contrast in light.

## Releasing the CLI

The repository's own `package.json` is `private` (it lists the web UI's dependencies), so the command-line tool is published as a separate, much smaller package built from it:

```bash
npm run build:cli      # dist/cli: index.js (the whole CLI, templates and dependencies inside, ~0.75 MB), package.json, README, LICENSE
```

```bash
npx vitest run src/engine/__tests__/cli-package.test.ts     # packs it, installs the tarball in an empty folder and uses it from there
```

The package is `ai-scaffolder` (MIT); `0.1.0` was published on 2026-11-23, by hand. The bundle is checked not to contain the build machine's home folder, user name or paths. Its `repository` field points at this GitHub repository (npm's trusted publishing needs it) and it has no `homepage`; npm generates provenance only for public repositories.

**Releasing (automated).** Push a version tag from `main`. `.github/workflows/release.yml` runs lint, types and every test, builds the package at that version and *stages* it on npm. Nothing is public until a maintainer approves it on npmjs.com (the package, then the **Staged Packages** tab, then **Approve**, with the passkey):

```bash
git tag v0.1.1 && git push origin v0.1.1
```

The workflow refuses a tag that is not `vMAJOR.MINOR.PATCH` (or `-rc.1` and the like, which go to the `next` tag, never `latest`) or that is not on `main`. It holds no npm token: it uses npm's trusted publishing (OIDC), whose identity can stage but cannot approve, and only the staging job can obtain it.

**One-time setup on npmjs.com** (package `ai-scaffolder`, then Settings, then Trusted Publisher, then GitHub Actions). The fields are case-sensitive, cannot be edited afterwards (delete and recreate), and npm only checks them when a release runs:

| Field | Value |
|---|---|
| Organization or user | `Blueray-Automation` |
| Repository | `Scaffolder` |
| Workflow filename | `release.yml` |
| Environment name | (leave empty) |
| Allowed actions | `npm stage publish` only; leave `npm publish` off |

Optionally, in the same settings page turn on "Require two-factor authentication and disallow tokens". The workflow has not run on GitHub yet: the first tag will show whether the trusted-publisher fields match.

**Releasing by hand** still works: `cd dist/cli && npm publish --access public` stages the version the same way (no `--otp`: a passkey is approved in the browser). npm holds a staged publish until a maintainer approves it with their 2FA: open the package on npmjs.com, go to **Staged Packages** and approve the version (publishing again meanwhile fails with `409 ... previously staged version`). `npm publish --dry-run --access public` in `dist/cli` shows exactly what would be published (four files) without sending anything.
