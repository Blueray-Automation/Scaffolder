# Build a Feature: the Chain

The shortest path from "I have requirements, a design and an API" to verified code. Always the same three moves: **bring in** what you have, **spec** it (an agent drafts, you review), **implement** it (an agent builds, the loop proves it).

> **The order is design, then API, then screens.** An API exists to serve the screens, so even the backend reads the design: it is how the agent knows which endpoints, fields and error states are needed. The design is not only for the frontend.

## What you bring

| You have | Bring it in with | What it decides |
|---|---|---|
| **Requirements** (PDF, Word, Markdown, text) | `spec requirements.pdf` | What is built: the PRD and the checks that prove it. The only input you cannot skip |
| **A design** (images, a PDF, a Figma link) | `--design mockups.pdf` | In a backend: which endpoints the screens need. In a frontend: what the screens look like in every state |
| **API documentation** (OpenAPI, Swagger, Postman, a link, a guide) | `--api api.yaml` | In a frontend: which operations it may call. Not needed for an API this project builds: its contract is already known |

Each one is optional except the requirements. With no design the agent works from the requirements alone, and a feature that calls no API says `No API calls.`.

## The simplest chain: one feature, every layer

A project with a backend and a screen (the default). In a generated project:

```bash
./scripts/sdlc spec requirements.pdf --design mockups.pdf   # 1. an agent drafts the PRD and its checks from the requirements AND the design
# 2. YOU review .ai/specs/FEAT-001-<feature>/prd.md, then set "Status: Accepted"
./scripts/sdlc implement FEAT-001                           # 3. the API and its contract first, then the client, then the screens
./scripts/sdlc verify                                       # 4. what CI runs
```

Step 2 is the only manual one, and it is the one that matters: the PRD is the contract, and an AI only drafted it. Step 3 never commits or pushes; you review `git diff`.
Inside the feature the agent is told to build in order, finishing each layer before the next: the API and its committed contract (what the design needs), the client that calls it (typed from that contract), the screens in every state.

## Layer by layer

For a bigger feature, or when the backend and the frontend are different repositories: the design, then the API, then the screens, each its own feature.

```bash
# BACKEND: the design tells it what the API must serve
./scripts/sdlc spec requirements.pdf --design mockups.pdf --focus "the API" --name orders-api
./scripts/sdlc implement FEAT-001          # builds the API and writes its contract, .ai/contract/openapi.json (you commit it with the code): that file IS the API's documentation

# FRONTEND: the design tells it what to build, the API's documentation what it may call
./scripts/sdlc api import <the backend's .ai/contract/openapi.json, or http://localhost:8000/openapi.json while it runs>   # only when the backend is another repository
./scripts/sdlc spec requirements.pdf --design mockups.pdf --focus "the screens" --name orders-screens
./scripts/sdlc implement FEAT-002
```

In one repository the second block needs no `api import`: the backend's contract is already known to the frontend as `backend` (`./scripts/sdlc api list`). In two repositories the contract travels between them as a file or as the running service's `/openapi.json`.

## The same chain for each kind of project

| Project | Chain |
|---|---|
| **Backend and screens** (Next.js or Nuxt, Flutter, with FastAPI) | `spec requirements.pdf --design mockups.pdf`, review, `implement`. One feature, or the two blocks above |
| **Backend only** | `spec requirements.pdf --design mockups.pdf`, review, `implement`. The design is the list of screens the API will serve. Hand `.ai/contract/openapi.json` to the frontend project afterwards |
| **Frontend only** (no backend of its own) | `spec requirements.pdf --design mockups.pdf --api api.yaml`, review, `implement`. Import the API once (`api import`) and leave `--api` out of the later features |

A large document with several features: run `spec` once per feature with `--focus "the login flow (section 3)"` and `--name login`.

## What each input becomes

- **The requirements** become the PRD's acceptance criteria, each citing where in the document it came from, and `acceptance.json`, the checks that run against the running system.
- **The design** is copied into the feature's `design/` folder (a PDF becomes one picture per page, a Figma link becomes a picture of each frame, with the text in it) and recorded with checksums. The agent is told to open every picture. A backend lists, for each screen, the data it shows and the actions it offers, and makes each an endpoint: that goes in the PRD's **Contract impact**. A frontend writes the **UI & design** section from it. See [Design and the UI](Design-and-the-UI).
- **The API documentation** is copied into `.ai/api/` and indexed. The PRD's **API integration** section may name only operations in it, and the spec fails on any other. See [API Integration](API-Integration).

One honest limit: the commands, the order and what each agent is shown are tested; whether an AI agent turns a mock-up into good endpoints is not. That is why step 2, your review of the PRD, is not optional.

## What each step proves, and what it does not

| Step | Proves | Does not prove |
|---|---|---|
| `spec` | The draft is complete: every criterion has a check, every operation is documented | That the draft is right. You review it |
| `implement` | Every criterion passes against the running system, the gates are green, nothing protected was edited | That the screen looks like the design (a review, with screenshots), or that someone else's API behaves as documented |
| `verify` | The same, in one pass, with no agent: what CI runs | |

If you would rather not use an agent, write the spec yourself (`./scripts/sdlc new <name>`) and the code yourself; `verify` and the gates work the same.

## Something went wrong

- `./scripts/sdlc doctor` says which tool is missing. `./scripts/sdlc agent` shows which AI agents are installed and lets you pick one.
- A `spec` draft that will not validate is sent back to the agent up to three times, then left for you with the problems listed.
- `implement --dry-run` and `spec --dry-run` print the prompt and the command and run nothing.
- [Troubleshooting](Troubleshooting) has the messages you are most likely to meet.
