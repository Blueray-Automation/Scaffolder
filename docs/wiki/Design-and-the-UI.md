# Design and the UI

A project can pass every test and still not look like the design. Tests prove behaviour; nothing in them knows what the design said.
Scaffolder treats the design the way it treats the API: as a **contract**, committed to the repository, that the code is built from and that a gate checks.

> **What this gives you, and what it cannot.** Every colour, space, radius and type size comes from one file of design tokens, every PRD says what each screen
> looks like in every state, and a gate fails when a screen cheats. It does **not** compare pixels with your Figma frame: whether the result looks like the design is a review,
> helped by reference images and screenshots in the pull request.

## The three layers

| Layer | What it is | Who checks it |
|---|---|---|
| **Tokens** | `.ai/design/tokens.json`: every colour (light and dark), space, radius and type size, by name. The stylesheet (web) or Dart file (Flutter) is generated from it. | The `repo.design` gate: tokens valid, generated files current, no hard-coded value |
| **The brief** | The PRD's **UI & design** section: the frame being built, every state of each screen, the components to reuse, new tokens, the exact copy, responsive and accessibility behaviour. Reference images sit next to the PRD in `design/`. | The spec check: a PRD without the section fails (`No UI change.` is a complete one) |
| **The review** | A screenshot of every state next to its reference image, and the differences listed, in the pull request. | A person (the skill `implement-ui` and the PR template say what to bring) |

A project with a screen (a web app, a Flutter app, or both) gets all three. A backend on its own has none.

## What is in a generated project

| File | What it is |
|---|---|
| `.ai/design/tokens.json` | The tokens. **You edit this**, or export it from your design tool. |
| `web/src/app/tokens.css` (Next.js), `web/app/assets/css/tokens.css` (Nuxt) | The tokens as CSS variables: `--color-accent`, `--space-md`, `--radius-lg`. Generated. |
| `mobile/lib/theme/tokens.dart` | The tokens as Dart constants: `Tokens.light.accent`, `Tokens.spaceMd`. Generated. |
| `mobile/lib/theme/app_theme.dart` | The Material themes (light and dark), built from the tokens. |
| `.ai/rules/design.md`, `.ai/skills/implement-ui/` | What an agent (or you) must do to build a screen from a design. |
| `.ai/design/README.md` | How the tokens work, in the project itself. |

The shipped hello page is built from the tokens, so there is a working example to copy.

## From a design to a verified screen

1. **Put the design in.** Bring the pictures in with `./scripts/sdlc design import` (a PDF, an image or a Figma link: see [Bringing a design in](#bringing-a-design-in)), and write the design's values as tokens in `.ai/design/tokens.json` (see [the tokens file](#the-tokens-file)), then run `./scripts/sdlc design sync`.
   Set `design.tool` and `design.url` in `scaffolder.config.yaml` to say where the design lives; they appear in the PRD template and the guide.
2. **Write the UI & design section** of the PRD (`./scripts/sdlc new <slug>` creates it as a template): the frame, every state, the components, any new token, the copy.
   The reference images (one per state and size) live in the feature's `design/` folder: `design import ... --feature FEAT-001` puts them there. An agent drafting the PRD from a document fills the section from the document only and marks gaps `ASSUMPTION:`.
3. **Build it** (`./scripts/sdlc implement FEAT-001`, or by hand). The agent is told to follow `implement-ui`: tokens first, one state at a time, test first.
4. **The gate.** `./scripts/sdlc design check` runs as the `repo.design` gate in `gates`, `verify` and CI. A screen that writes `#ff0000` or `padding: 12px` fails with the file and line.
5. **The review.** The PR carries a screenshot of each state beside its reference and a list of the differences, including the ones you left on purpose.

## Bringing a design in

A design arrives as a PDF, a picture or a Figma link. `design import` turns each into **reference images** and a record, `references.json`, with what each file is, where it came from, its size and its checksum.
The gate checks the record, so a reference cannot be edited or swapped unnoticed, and `./scripts/sdlc implement` shows the pictures to the agent.

```bash
./scripts/sdlc design import mockups.pdf --feature FEAT-001            # each page (up to 20) becomes a picture, plus the text in the PDF
./scripts/sdlc design import login.png signup.png --feature FEAT-001   # PNG, JPEG, WebP or GIF, up to 15 MB each
export FIGMA_TOKEN=...                                                 # PowerShell: $env:FIGMA_TOKEN = "..."
./scripts/sdlc design import "https://www.figma.com/design/<key>/<name>?node-id=1-2" --feature FEAT-001
./scripts/sdlc design import brand-guide.pdf --project                 # a style guide for the whole project
```

| Source | You get | How exact | Needs |
|---|---|---|---|
| **Image** | The picture, with its size | Exact (it is the file) | Nothing |
| **PDF** | One picture per page (`--pages 2-5`, `--dpi 200`), and the text found in the PDF as a `.txt` | The pictures are exact; the text is as good as the PDF's own text layer | poppler's `pdftoppm` (macOS `brew install poppler`, Ubuntu `sudo apt install poppler-utils`, Windows `scoop install poppler`). Without it macOS can render page 1 only, at 72 dpi |
| **Figma** | A PNG of the frame (or of each frame on a page or section), its text in reading order, and a census of the colours, type sizes, radii and spacing it uses | Exact values from the file, but the census lists what is used, not what each value is called | A personal access token in `FIGMA_TOKEN` with the `file_content:read` scope |

- **Where it goes.** `--feature FEAT-001` saves in that feature's `design/` folder, next to its PRD, which an agent may not edit while it heals. `--project` saves in `.ai/design/references/`, for a style guide.
- **Figma details.** The link's frame is exported at 2x (`--scale`); a link to a page or a section exports its frames; a link with no frame lists the frames to choose from. An import makes two requests to Figma, because its rate limits are tight (a view-only seat gets very few a month).
  The token is read only from the environment, sent only to Figma, and never written anywhere. A node id written `1-2` in a link and `1:2` in the API are both accepted.
  `--variables` also proposes tokens from the file's variables into `.ai/design/tokens.proposed.json`; that API is for Figma Enterprise plans, so on any other plan it is skipped with a note. Nothing reads the proposal: its names are Figma's, so rename them to this project's names and save it as `tokens.json`.
- **What import does not do.** It does not read the design's meaning. The tokens and the PRD's UI & design section are still written by a person, or drafted by an agent and reviewed. Colours measured from a picture are approximate, and a PDF of flat pictures has no values at all, only pixels.

## The tokens file

A token is `{ "$value": ... }`, a group holds tokens, and `$type` on a group applies to everything inside it: the shape the Design Tokens Community Group uses, so tools that read or write it
need little or no conversion. A dark-theme value is `"$extensions": { "scaffolder": { "dark": "#..." } }`. Names use lowercase letters, digits and dashes.

```json
{
  "color": {
    "$type": "color",
    "accent": { "$value": "#4f46e5", "$extensions": { "scaffolder": { "dark": "#818cf8" } } }
  },
  "space": { "$type": "dimension", "md": { "$value": "1rem" } }
}
```

| `$type` | Value | Web | Flutter |
|---|---|---|---|
| `color` | `#rrggbb` or `#rrggbbaa` | `--color-accent` (dark values in a `prefers-color-scheme` block) | `Tokens.light.accent`, `Tokens.dark.accent` |
| `dimension` | a number and `px`, `rem` or `em` | `--space-md` | `Tokens.spaceMd` (`rem` is 16 logical pixels; `em` is web only) |
| `fontWeight` | `100` to `900` | `--font-weight-semibold` | `Tokens.fontWeightSemibold` |
| `fontFamily` | a font stack | `--font-family-base` | not generated |

Seven colours are required because the themes use them: `accent`, `bg`, `border`, `card`, `danger`, `fg`, `muted`. Add anything else you like (`size.sidebar`, `color.success`).
The files are written in a fixed order, so the same tokens always produce the same bytes.

Turning a design into tokens is still a person's step. The Figma census (and, on Enterprise plans, `--variables`) is a starting point; a plugin such as Tokens Studio can write this shape from Figma, and Penpot exports design tokens too, so check what your tool writes against the table above. A hand-written file is just as good.

## What the gate checks

`./scripts/sdlc design check` fails when:

- `tokens.json` is invalid: a bad colour, a missing required colour, two tokens that become the same name. The message names the token.
- A generated file is not what the tokens produce: someone edited it, or the tokens changed without `./scripts/sdlc design sync`. `sync` rewrites the files.
- A screen hard-codes a design value. On the web: a hex colour or `rgb()`, `hsl()` and similar anywhere in the source, a colour name in a stylesheet or a Vue `<style>` block, and a pixel or `rem` length for
  `margin`, `padding`, `gap`, `border-radius` or `font-size` (in a stylesheet or in an inline style such as `padding: "12px"`). In Flutter: `Color(0x...)`, `Colors.red`, a number in `EdgeInsets`, `SizedBox`, `Radius.circular` or `fontSize`.
- A stylesheet uses `var(--something)` that no token or stylesheet defines, which would otherwise silently render as nothing.

Tests (`__tests__`, `test/`, `*.test.*`) and the generated files are not read. A value that is deliberately not a token takes a comment on its line, `design:allow: <why>`; the review reads each one.
The gate is switched off with `design.enforce: false` (or with the lint gates, `sdlc.gates.lint: false`); the tokens still style the shipped screens, and `design check` still works by hand.

## What it does not check

- That the screen **looks like** the design. Layout, order, rhythm and proportion are for the reviewer.
- What is in a design's pictures: import records them, it does not understand them.
- Spacing written as a bare number in an inline style (`padding: 12`), Tailwind arbitrary values (`p-[13px]`), and sizes in an image, an icon or a font file.
- Whether a state the PRD lists was actually built. Write a test per state, and have the spec's checks name those tests: that is what makes a missing state fail.

Not built yet: comparing screenshots with the reference images automatically (visual regression), importing HTML prototypes, and the design contract in `adopt`ed existing projects.

## Configuration

```yaml
design:
  enforce: true        # the repo.design gate, and the UI & design section in every PRD
  tool: figma          # none | figma | penpot | other: wording in the guide and the PRD template
  url: https://www.figma.com/design/...   # where the design lives
```

## How this was checked

The generators for the web (CSS) and Flutter (Dart) output were run with the generated projects' own `./scripts/sdlc design` and compared byte for byte with the ones the scaffolder writes;
every kind of hard-coded value above is a test that must fail the gate, and the values it must not flag are tests too. A generated Flutter app was analysed (`flutter analyze --fatal-infos`), formatted and tested with the real SDK.
`npm run e2e` generated a Next.js, a Nuxt and a Flutter-only project, installed them and ran every gate and the facts, with a screen that cheats, an edited generated file and a changed token each failing the gate and `design sync` repairing them; the Nuxt run also built and ran its Docker images with the tokens in them.
Import: images, and a PDF rendered by the real poppler (`pdftoppm`), were run for real, as were the checks that refuse a bad file or a missing renderer. **The Figma import was run against a stand-in server written from Figma's documentation, not against Figma itself**: the field names and the rate-limit headers follow the documented API, but nobody has yet run it with a real token and file, so expect to meet a difference the first time.
Not run: the Next.js project's Docker image build (image pulls hung on the machine used), Windows, the generated GitHub workflow on GitHub, and any real Figma export.
