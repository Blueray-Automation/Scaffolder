# Scaffolder

Scaffolder generates **AI-ready** full-stack projects where *"done" is proven, not claimed*.

Every generated project follows **PRD -> Code -> Test -> Deploy**, ships a working hello world, and carries a **verification loop**: it doesn't just run unit tests, it starts the real system and checks every requirement in the PRD against it, then lets an AI agent (or you) heal failures until everything is green.

```
   PRD (AC-001 ...)  ->  acceptance.json (checks)  ->  code + tests
         \                                                |
          \-------------- ./scripts/sdlc loop ------------+
              gates -> facts -> evidence -> heal -> verify again
```

## Pick your path

| I want to | Read |
|---|---|
| Install the tools on macOS, Ubuntu or Windows | [Setup by Operating System](Setup-by-Operating-System) |
| Go from a downloaded zip to a verified, running hello world | [Getting Started](Getting-Started) |
| Choose between Next.js, Nuxt, FastAPI and Flutter, and see what is generated | [Stacks and Options](Stacks-and-Options) |
| Build a feature from a requirements document, end to end | [Tutorial: Add a Login API](Tutorial-Add-a-Login-API) |
| Make the UI match a design from Figma, a PDF or an image | [Design and the UI](Design-and-the-UI) |
| Add the verification loop to a repository I already have | [Adopt an Existing Project](Adopt-an-Existing-Project) |
| Let the Claude desktop app, Cursor or VS Code be the AI agent | [Using a Desktop App](Desktop-Apps) |
| Understand gates, facts, evidence and healing | [The Verification Loop](The-Verification-Loop) |
| See the complete, verified code of the tutorial | [Reference: login code](Reference-Login-Implementation) |
| Fix something that broke | [Troubleshooting](Troubleshooting) |
| Know what has and has not been verified | [Status and Limits](Status-and-Limits) |
| Change Scaffolder itself, or release it | [Contributing and Releasing](Contributing-and-Releasing) |

New here? Read the first three rows in order: setup, getting started, then the tutorial.

## About this wiki

These pages live in the repository under `docs/wiki/` and are published to the GitHub wiki automatically whenever they change on `main`. **Edit the files in `docs/wiki/`, not the wiki pages in the browser**: browser edits are overwritten on the next publish. The same pages are in the web app under **Docs**, with search.
