# ai-scaffolder

Generate **AI-ready** full-stack projects where *"done" is proven, not claimed*, or add the same verification loop to a repository you already have.

## Add it to an existing repository

```bash
npx ai-scaffolder adopt ./my-repo            # a dry run: what it found, which gates it will run, which files it would write
npx ai-scaffolder adopt ./my-repo --write    # writes .ai/ and one marked block in AGENTS.md; never overwrites a file of yours
cd my-repo
./.ai/sdlc doctor && ./.ai/sdlc setup && ./.ai/sdlc baseline    # record what passes today, then commit .ai/
./.ai/sdlc verify                                                # from now on: nothing that passed may fail
```

The gates are your repository's own commands (npm, pnpm, yarn and bun scripts, ruff, mypy, pytest, Makefile targets), each with the place it was found; what it cannot detect is listed, never invented.
Existing code is rarely green, so "done" means *nothing that passed on adoption day fails now*, plus every acceptance criterion of the feature you are building.
`./.ai/sdlc onboard` has an AI agent draft a map of the code and its conventions, then checks every path and command the draft cites; `spec` and `implement` turn a requirements document into verified code.

## Start a new project

```bash
npx ai-scaffolder init                                                   # writes scaffolder.config.yaml
npx ai-scaffolder generate --config scaffolder.config.yaml --out ./my-app
npx ai-scaffolder list                                                   # what can be generated today
```

## Good to know

- Needs Node.js 20 or newer. The tooling it writes into your repository (`./.ai/sdlc`) is plain Python 3.9+ and git.
- The command reads the folder you give it and writes files into it. It makes no network requests and sends nothing anywhere.
- `adopt` detects Node and Python projects and Makefiles; anything else you add as a gate in its settings file. It has been tested on in-memory repositories, on throwaway git repositories and on a clone of its own repository, not yet on Windows or on third-party repositories.
- MIT licensed.
