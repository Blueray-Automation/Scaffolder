# The Verification Loop

Every generated project contains `./scripts/sdlc`, a small tool (standard-library Python, no installs) that decides whether work is **done**.
The rule it enforces: *done means `./scripts/sdlc verify` exits 0 and you can show its report.*

## Commands

| Command | What it does |
|---|---|
| `./scripts/sdlc doctor` | Checks your toolchain |
| `./scripts/sdlc setup` | Installs dependencies for every component |
| `./scripts/sdlc gates` | Lint, types, unit tests, build, contract, security (no running system needed) |
| `./scripts/sdlc facts` | Checks every PRD requirement against the **running** system |
| `./scripts/sdlc verify` | Gates + facts. This is exactly what CI runs |
| `./scripts/sdlc loop` | verify, then heal, then verify... until green or out of budget |
| `./scripts/sdlc feature <name>` | PRD, then code, then test (the loop) for one feature |
| `./scripts/sdlc new <slug>` | Creates a feature spec from the template |
| `./scripts/sdlc deploy <env>` | Runs the deploy script, then checks the live URL |
| `./scripts/sdlc secrets` | Scans for committed secrets |
| `./scripts/sdlc report` | Prints the latest report |

Useful flags: `--only <gate-id>`, `--stage <stage>`, `--keep-going`, `--runtime docker|local|none`, `--feature FEAT-001`.

## Gates

Commands defined once in `.ai/sdlc.json` and mirrored in the CI workflow, so "green locally" and "green in CI" mean the same thing.
They run in stages: `static -> unit -> build -> contract -> facts -> security`. By default a failing stage stops the run, so you (or an agent) see one focused problem.

## Facts

Each feature folder under `.ai/specs/` has:

- `prd.md`: acceptance criteria, one per line: `- **AC-001** Given ... when ... then ...`
- `acceptance.json`: **checks** that prove them.

Verification **fails** if a criterion has no check, or a check points at a criterion that doesn't exist. Then it starts the system and runs the checks.

```json
{
  "id": "CHK-001",
  "name": "Liveness endpoint answers ok",
  "covers": ["AC-001"],
  "type": "http",
  "target": "backend",
  "path": "/health",
  "expect": { "status": 200, "json": { "status": "ok" } }
}
```

| Check type | Fields |
|---|---|
| `http` | `target` (`backend` or `web`), `method`, `path`, `headers`, `body`, `expect`: `status`, `json` (subset match), `bodyContains`, `headers`, `maxMs` |
| `cmd` | `run`, `cwd`, `expectExit`, `stdoutContains`, `pathPrepend` |
| `file` | `path`, `exists`, `contains`, `regex` |

JSON matchers: exact values, or `"$exists"`, `"$type:string"` (also number, boolean, array, object, null), `"$re:^Hello"`.

**Honesty rules:** a check that needs something the current runtime doesn't have (for example the database in `--runtime local`) is reported as `SKIP`, never as pass.
Against a *deployed* environment (`facts --no-runtime --base-url web=https://...`) only `http` checks whose target has a URL run; `cmd` and `file` checks verify the repository and are skipped there.

## Evidence

Every run writes `.ai/evidence/<run-id>/` (`report.md`, `results.json`, one log per gate, runtime logs) and refreshes `.ai/evidence/latest/`.
The report shows each criterion, the checks that prove it, and the result. CI uploads it as an artifact.

## The healing loop

```
verify -> green? -> done (exit 0)
   |
   +-> failed: fingerprint the failures
         same failure N times in a row -> stop, ask a human (exit 3)
         out of iterations              -> stop (exit 1)
         write a heal prompt from .ai/prompts/heal.md + the evidence
         run the agent (or wait for you if none is configured)
         integrity check: did the agent touch protected files?  -> stop (exit 4)
         verify again
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Verified |
| 1 | Verification failed, or the iteration budget ran out |
| 2 | Needs a human (no agent configured and not interactive, or the PRD is still a stub) |
| 3 | No progress: the same failure repeated |
| 4 | Integrity violation: files that define "correct" were changed while healing |

### Integrity guard

An agent that is told to "make the tests pass" can cheat by changing the tests. So some files are off limits:

- **Always protected:** `.ai/sdlc.json`, `scripts/sdlc*`, `.github/workflows/`.
- **Protected while healing:** `.ai/specs/` (healing fixes code, not requirements).
- **Guarded:** `.ai/contract/` may change, but the change is reported for review.

### Using an AI agent

The agent is any command that reads the prompt on standard input. Set it in `scaffolder.config.yaml` (`sdlc.agent.command`) before generating, edit `agent.command` in `.ai/sdlc.json`, or set it for one run:

```bash
SDLC_AGENT_CMD='your-agent-cli' ./scripts/sdlc loop
```

With no agent, the loop prints the prompt file for you (or your own AI tool) and waits. The loop's mechanics are tested with scripted agents;
how well a particular agent follows the prompts depends on that agent.

## Configure it

Everything above is configurable in `scaffolder.config.yaml`: which gates run, coverage floors, runtime mode, iteration budget,
no-progress limit, fail-fast, agent command and timeout, extra protected paths. Regenerate to apply, or edit `.ai/sdlc.json` directly (a human decision: agents are blocked from it).
