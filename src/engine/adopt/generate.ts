import { hasErrors, resolveAgentCommand, type Issue } from "../config";
import { isExecutable, withLineEndings, type GeneratedFile } from "../generate";
import { STAGE_ORDER } from "../gates";
import { renderTemplate } from "../render";
import { buildAgentSection } from "../sdlcConfig";
import { TEMPLATE_FILES } from "../templates.generated";
import { resolveAdoptConfig, validateAdoptConfig, type AdoptConfig } from "./config";
import { detectProject, type DetectedGate, type DetectedSetup, type Detection, type RepoSnapshot } from "./detect";

/**
 * Adoption: write the `.ai/` operating system into a repository that already exists.
 *
 * The runner (`sdlc.py` and its launchers) is the same file a generated project gets: it already runs any shell command
 * as a gate. What differs is who decides the gates (detection of what the repository defines, not a stack we generate),
 * and the definition of done (a baseline: no gate that passed on adoption day may fail, instead of "everything is green").
 */

export const ADOPT_DIR = ".ai";
export const BASELINE_FILE = ".ai/baseline.json";
export const SECRETS_BASELINE_FILE = ".ai/secrets.baseline.json";
/** The two files `sdlc onboard` has an agent draft, and the person reviews. */
export const ONBOARD_FILES = { architecture: ".ai/context/architecture.md", conventions: ".ai/rules/conventions.md" };

/** The runner comes from the core pack; it is mounted into `.ai/` instead of `scripts/`. */
const RUNNER_FILES: Record<string, string> = {
  "core/scripts/sdlc.py.tmpl": ".ai/sdlc.py",
  "core/scripts/sdlc.tmpl": ".ai/sdlc",
  "core/scripts/sdlc.cmd.tmpl": ".ai/sdlc.cmd",
};

const AGENTS_BLOCK_TEMPLATE = "adopt/_agents-block.md.tmpl";
export const AGENTS_BEGIN = "<!-- scaffolder:begin -->";
export const AGENTS_END = "<!-- scaffolder:end -->";

export interface AdoptResult {
  detection: Detection;
  config: AdoptConfig;
  issues: Issue[];
  /** Everything to write inside the repository, `.ai/` only. */
  files: GeneratedFile[];
  /** The managed block for the root AGENTS.md (merge it with `mergeAgentsBlock`), or null when rootFile is "none". */
  agentsBlock: string | null;
  /** Things to do by hand that adoption deliberately does not do for you. */
  hints: string[];
}

function finalGates(config: AdoptConfig, detection: Detection): DetectedGate[] {
  const kept = detection.gates.filter((g) => !config.gates.exclude.includes(g.id));
  const added: DetectedGate[] = config.gates.add.map((g) => ({
    id: g.id,
    label: g.label,
    stage: g.stage,
    cwd: g.cwd ?? ".",
    cmd: g.cmd,
    required: g.required ?? true,
    timeoutSeconds: g.timeoutSeconds ?? 600,
    ...(g.env ? { env: g.env } : {}),
    ...(g.pathPrepend ? { pathPrepend: g.pathPrepend } : {}),
    component: "custom",
    evidence: "adopt config (gates.add)",
  }));
  const secrets: DetectedGate = {
    id: "repo.secrets",
    label: "No new secrets committed (built-in scan; findings from adoption day are the baseline)",
    stage: "security",
    cwd: ".",
    cmd: `python3 ${ADOPT_DIR}/sdlc.py secrets`,
    required: true,
    timeoutSeconds: 120,
    component: "repo",
    evidence: "built in",
  };
  return [...kept, ...added, secrets].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
}

function gateJson(g: DetectedGate): Record<string, unknown> {
  return {
    id: g.id,
    label: g.label,
    stage: g.stage,
    component: g.component,
    cwd: g.cwd,
    cmd: g.cmd,
    required: g.required,
    timeoutSeconds: g.timeoutSeconds,
    ...(g.env ? { env: g.env } : {}),
    ...(g.pathPrepend ? { pathPrepend: g.pathPrepend } : {}),
  };
}

function setupJson(s: DetectedSetup): Record<string, unknown> {
  return {
    id: s.id,
    label: s.label,
    component: s.component,
    cwd: s.cwd,
    cmd: s.cmd,
    toolchain: s.toolchain,
    manifests: s.manifests,
    marker: s.marker,
    tools: s.tools,
    ...(s.lockfile ? { lockfile: s.lockfile, fallbackCmd: s.fallbackCmd } : {}),
    ...(s.minPython ? { minPython: s.minPython } : {}),
    ...(s.venv ? { venv: s.venv } : {}),
    trustExisting: s.trustExisting,
  };
}

/** The machine-readable `.ai/sdlc.json` for an adopted repository. */
export function buildAdoptSdlcConfig(config: AdoptConfig, detection: Detection, gates: DetectedGate[], setup: DetectedSetup[]): Record<string, unknown> {
  const rt = config.runtime;
  const project = `${config.project.name}-sdlc`;
  const compose = `docker compose -p ${project} -f ${rt.docker.composeFile}`;
  return {
    version: 1,
    project: config.project.name,
    stages: STAGE_ORDER,
    loop: { maxIterations: config.sdlc.maxIterations, noProgressLimit: config.sdlc.noProgressLimit, failFast: config.sdlc.failFast },
    // The definition of done for existing code: what passed on adoption day may not fail (see `sdlc baseline`).
    ratchet: { enabled: true, baseline: BASELINE_FILE },
    // Programs the gates run: `doctor` checks that they are installed.
    tools: detection.tools,
    secrets: { baseline: SECRETS_BASELINE_FILE },
    agent: buildAgentSection({
      preset: config.sdlc.agent.preset,
      command: resolveAgentCommand(config.sdlc.agent.preset, config.sdlc.agent.command),
      timeoutSeconds: config.sdlc.agent.timeoutSeconds,
    }, { onboard: ".ai/prompts/onboard.md", onboardFix: ".ai/prompts/onboard-fix.md" }),
    // `sdlc onboard`: an agent drafts a map of the code and its conventions; the tool checks every path and command the draft cites.
    onboard: ONBOARD_FILES,
    integrity: {
      // Verification machinery: the agent may never edit these (all phases).
      protected: [
        ".ai/sdlc.json",
        ".ai/sdlc",
        ".ai/sdlc.cmd",
        ".ai/sdlc.py",
        BASELINE_FILE,
        SECRETS_BASELINE_FILE,
        ".github/workflows/",
        ...config.sdlc.protectedPaths,
      ],
      // Requirements and checks: frozen while healing (healing fixes code, not the goalposts).
      protectedWhileHealing: [".ai/specs/"],
      // The repository's own lint/type/test configuration: changes are allowed but every one is listed for review.
      guarded: [...new Set([...detection.guardedPaths, ...config.sdlc.guardedPaths])].sort(),
    },
    setup: setup.map(setupJson),
    gates: gates.map(gateJson),
    runtime: {
      mode: rt.mode,
      targets: rt.targets,
      docker: {
        composeFile: rt.docker.composeFile,
        // A project name of its own: the stack the facts start never touches containers or volumes of the developer's own dev stack.
        up: `${compose} up -d --build --wait`,
        down: `${compose} down --volumes --remove-orphans`,
        logs: `${compose} logs --no-color --tail=200`,
        provides: rt.docker.provides,
      },
      local: { provides: rt.local.services.map((s) => s.name), services: rt.local.services },
    },
    facts: {
      enabled: true,
      specsDir: ".ai/specs",
      strictSkips: false,
      // A repository that already exists has no feature specs on day one: that is not a failure.
      requireSpec: false,
    },
    deploy: { target: "none", script: "", environments: [] },
  };
}

function buildAdoptView(config: AdoptConfig, detection: Detection, gates: DetectedGate[], setup: DetectedSetup[], hasAgentsBlock: boolean) {
  const preset = config.sdlc.agent.preset;
  const command = resolveAgentCommand(preset, config.sdlc.agent.command);
  // AGENTS.md is the file the block goes into; only the other instruction files are worth pointing at.
  const otherAgentFiles = detection.existing.agentFiles.filter((p) => p !== "AGENTS.md");
  const title = config.project.name
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    sdlcDir: ADOPT_DIR,
    slug: config.project.name,
    title,
    description: config.project.description || `the ${title} repository`,
    stages: STAGE_ORDER.join(" → "),
    maxIterations: config.sdlc.maxIterations,
    noProgressLimit: config.sdlc.noProgressLimit,
    agentConfigured: command.length > 0,
    agentPreset: preset,
    agentCommand: command,
    runtimeMode: config.runtime.mode,
    hasRuntime: config.runtime.mode !== "none",
    hasAgentsBlock,
    baselineFile: BASELINE_FILE,
    gates: gates.map((g) => ({ id: g.id, label: g.label, stage: g.stage, cmd: g.cmd, cwd: g.cwd, required: g.required, evidence: g.evidence })),
    hasGates: gates.length > 0,
    setup: setup.map((s) => ({ id: s.id, label: s.label, cwd: s.cwd, cmd: s.cmd, existing: s.marker !== "" ? `(an existing \`${s.marker}\` is used as it is)` : "" })),
    hasSetup: setup.length > 0,
    components: detection.components.map((c) => ({ id: c.id, dir: c.dir, kind: c.kind, summary: c.summary })),
    hasComponents: detection.components.length > 0,
    notCovered: detection.notCovered.map((text) => ({ text })),
    hasNotCovered: detection.notCovered.length > 0,
    suggestions: detection.suggestions.map((text) => ({ text })),
    hasSuggestions: detection.suggestions.length > 0,
    guarded: detection.guardedPaths.concat(config.sdlc.guardedPaths).map((path) => ({ path })),
    hasGuarded: detection.guardedPaths.length + config.sdlc.guardedPaths.length > 0,
    existingAgentFiles: otherAgentFiles.map((path) => ({ path })),
    hasExistingAgentFiles: otherAgentFiles.length > 0,
    hasCi: detection.existing.ci.length > 0,
  };
}

/** Insert or refresh the managed block in the text of an AGENTS.md. Never touches anything outside the markers. */
export function mergeAgentsBlock(existing: string | undefined, block: string): { content: string; problem?: string } {
  if (existing === undefined || existing.trim() === "") return { content: `# AGENTS.md\n\n${block}\n` };
  const start = existing.indexOf(AGENTS_BEGIN);
  const end = existing.indexOf(AGENTS_END);
  if (start >= 0 && end > start) {
    return { content: existing.slice(0, start) + block + existing.slice(end + AGENTS_END.length) };
  }
  if (start >= 0 || end >= 0) {
    return { content: existing, problem: `AGENTS.md has a ${start >= 0 ? "begin" : "end"} marker of the scaffolder block without its pair. Fix or remove it, then run adopt again.` };
  }
  return { content: `${existing.replace(/\s+$/, "")}\n\n${block}\n` };
}

/** Adopt a repository: detect what is there, validate the settings, render the `.ai/` files. Pure: no filesystem access. */
export function adoptProject(snapshot: RepoSnapshot, input: unknown = {}): AdoptResult {
  const detection = detectProject(snapshot);
  const config = resolveAdoptConfig(input, detection);
  const issues = validateAdoptConfig(config, detection);
  if (hasErrors(issues)) return { detection, config, issues, files: [], agentsBlock: null, hints: [] };

  const gates = finalGates(config, detection);
  const setup = detection.setup;
  const wantsBlock = config.rootFile === "agents-block";
  const view = buildAdoptView(config, detection, gates, setup, wantsBlock);

  const files: GeneratedFile[] = [];
  const add = (path: string, content: string) => files.push({ path, content: withLineEndings(path, content), executable: isExecutable(path) });

  for (const [key, tpl] of Object.entries(TEMPLATE_FILES)) {
    if (key === AGENTS_BLOCK_TEMPLATE) continue;
    const runner = RUNNER_FILES[key];
    if (runner) {
      add(runner, renderTemplate(tpl.content, view, key));
    } else if (key.startsWith("adopt/")) {
      add(key.slice("adopt/".length).replace(/\.tmpl$/, ""), renderTemplate(tpl.content, view, key));
    }
  }
  add(".ai/sdlc.json", JSON.stringify(buildAdoptSdlcConfig(config, detection, gates, setup), null, 2) + "\n");

  const block = TEMPLATE_FILES[AGENTS_BLOCK_TEMPLATE];
  const agentsBlock = wantsBlock && block ? renderTemplate(block.content, view, AGENTS_BLOCK_TEMPLATE).trimEnd() : null;
  const wrapped = agentsBlock === null ? null : `${AGENTS_BEGIN}\n${agentsBlock}\n${AGENTS_END}`;

  const hints: string[] = [];
  const claude = snapshot.read("CLAUDE.md");
  if (wantsBlock && claude !== undefined && !/AGENTS\.md|\.ai\//.test(claude)) {
    hints.push("Claude Code reads CLAUDE.md, not AGENTS.md: add the line `@AGENTS.md` to CLAUDE.md so it picks up the .ai/ instructions.");
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) throw new Error(`Two sources generated the same file: ${f.path}`);
    seen.add(f.path);
  }
  return { detection, config, issues, files, agentsBlock: wrapped, hints };
}
