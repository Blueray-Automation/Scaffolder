"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, CircleX, FolderTree, ListChecks, Package, ShieldCheck, Terminal } from "lucide-react";
import { AGENT_PRESETS, adoptProject, mergeAgentsBlock, snapshotFromFiles, type GeneratedFile } from "@/engine";
import { buildAdoptCommand, DEFAULT_AGENT_PRESET, NPM_PACKAGE } from "@/lib/adoptCommand";
import { FileExplorer } from "./FileExplorer";
import { Badge, CopyBlock, Field, Section, Select, TextInput, Toggle } from "./ui";

/**
 * A small repository to show what adoption does. The output below is produced by the same engine the command line uses,
 * on every build, so this page cannot describe files or gates that the tool no longer writes.
 */
const SAMPLE = snapshotFromFiles(
  {
    "package.json": JSON.stringify(
      {
        name: "shop",
        scripts: { lint: "eslint .", "type-check": "tsc --noEmit", test: "vitest run", build: "next build", start: "next start" },
        dependencies: { next: "16" },
        devDependencies: { vitest: "3" },
      },
      null,
      2,
    ),
    "package-lock.json": "{}",
    "tsconfig.json": "{}",
    "eslint.config.mjs": "export default [];\n",
    "api/pyproject.toml": '[project]\nname = "api"\nrequires-python = ">=3.11"\n[project.optional-dependencies]\ndev = ["pytest", "ruff"]\n[tool.ruff]\nline-length = 100\n[tool.pytest.ini_options]\naddopts = "-q"\n',
    "api/tests/test_orders.py": "def test_orders(): ...\n",
    "CLAUDE.md": "# Notes for Claude\nUse tabs.\n",
    ".github/workflows/ci.yml": "name: ci\n",
  },
  "shop",
);

const SAMPLE_RESULT = adoptProject(SAMPLE);
const SAMPLE_FILES: GeneratedFile[] = [
  ...SAMPLE_RESULT.files,
  ...(SAMPLE_RESULT.agentsBlock ? [{ path: "AGENTS.md", content: mergeAgentsBlock(undefined, SAMPLE_RESULT.agentsBlock).content, executable: false }] : []),
].sort((a, b) => a.path.localeCompare(b.path));

const AGENT_OPTIONS = AGENT_PRESETS.filter((p) => p.id !== "custom").map((p) => ({ id: p.id, label: p.label }));

const STEPS: Array<{ title: string; text: string; code: string; label: string }> = [
  {
    title: "See what it would do",
    text: "A dry run. It lists what it found in your repository, the gates it will run (your own scripts), what it cannot cover, and every file it would write. Nothing is written.",
    code: `npx ${NPM_PACKAGE} adopt ./my-repo`,
    label: "dry run",
  },
  {
    title: "Write it",
    text: "Adds the .ai/ folder and one marked block in AGENTS.md. A file of yours is never overwritten: if it already exists and differs, it is kept and listed.",
    code: `npx ${NPM_PACKAGE} adopt ./my-repo --write`,
    label: "write the files",
  },
  {
    title: "Record the starting line",
    text: "Run every check once and write down what passes today. Then commit .ai/ together with baseline.json. An existing node_modules or virtual environment is used as it is, never wiped.",
    code: `cd my-repo
./.ai/sdlc doctor      # are the tools installed?
./.ai/sdlc setup       # install dependencies
./.ai/sdlc baseline    # run every gate once, record what passes`,
    label: "record the baseline",
  },
  {
    title: "Let an agent describe the repository (recommended)",
    text: "An agent drafts a map of the code and its conventions, folding in any CLAUDE.md or .cursor rules you already have. The tool then checks every path and command the draft cites against your repository. You review the draft: it stays marked Draft until you do.",
    code: "./.ai/sdlc onboard",
    label: "onboard",
  },
  {
    title: "Build a feature, proven",
    text: "Write a spec (or draft one from a requirements document), let an agent implement it, and the same checks decide whether it is done. Nothing is ever committed for you.",
    code: `./.ai/sdlc new export-csv           # or: ./.ai/sdlc spec requirements.pdf
./.ai/sdlc implement FEAT-001       # an agent writes tests and code, the loop proves it
./.ai/sdlc verify                   # nothing that passed on day one may fail`,
    label: "build a feature",
  },
];

const RATCHET: Array<{ then: string; now: string; result: React.ReactNode }> = [
  { then: "passed", now: "passes", result: <span className="text-emerald-300">Pass</span> },
  { then: "passed", now: "fails", result: <span className="text-red-300">FAIL: a regression, it blocks</span> },
  { then: "failed", now: "fails", result: <span className="text-amber-300">Known warning: it does not block, and it is not the agent’s job</span> },
  { then: "failed", now: "passes", result: <span className="text-emerald-300">Now passing: lock it in with `baseline --tighten`</span> },
];

const DETECTS: Array<{ found: string; becomes: string }> = [
  { found: "package.json scripts lint, type-check, test, build (npm, pnpm, yarn or bun, by lockfile)", becomes: "node.lint, node.types, node.test, node.build" },
  { found: "pyproject.toml, requirements files or setup.py with ruff, flake8, mypy or pytest (also Poetry and uv)", becomes: "python.ruff, python.mypy, python.pytest" },
  { found: "A Makefile with lint, test or build targets, when there is no Node or Python project", becomes: "make.lint, make.test, make.build" },
  { found: "Anything else (Go, Rust, Java …)", becomes: "Listed as “not covered”; add its commands as gates in a settings file" },
];

export function ExistingProject() {
  const [dir, setDir] = useState("./my-repo");
  const [write, setWrite] = useState(false);
  const [force, setForce] = useState(false);
  const [leaveAgentsMd, setLeaveAgentsMd] = useState(false);
  const [agentPreset, setAgentPreset] = useState(DEFAULT_AGENT_PRESET);
  const command = useMemo(() => buildAdoptCommand({ dir, write, force, leaveAgentsMd, agentPreset }), [dir, write, force, leaveAgentsMd, agentPreset]);
  const gates = JSON.parse(SAMPLE_RESULT.files.find((f) => f.path === ".ai/sdlc.json")?.content ?? "{}") as { gates?: Array<{ id: string; stage: string; cmd: string; cwd: string }> };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Add the AI setup to a project you already have</h1>
        <p className="max-w-3xl text-sm leading-7 text-zinc-300">
          One command adds an <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[12px]">.ai/</code> folder to your repository. Your own lint, test and build commands become one verification loop, AI agents get rules and a specification to work from, and
          “done” means <strong className="text-zinc-100">nothing that passed yesterday fails today</strong>. Your code, your dependencies and your CI are not touched.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="ok"><Check className="h-3.5 w-3.5" /> No account or login</Badge>
          <Badge tone="info"><Terminal className="h-3.5 w-3.5" /> Needs Node 20+ and a terminal</Badge>
          <Badge tone="info"><ShieldCheck className="h-3.5 w-3.5" /> Reads your folder and writes into it; sends nothing anywhere</Badge>
        </div>
        <p className="text-xs text-zinc-500">
          This page cannot read your folder (a browser may not), so the command line does the work. Everything it does is explained below and in the <Link href="/docs/Adopt-an-Existing-Project" className="text-indigo-300 underline underline-offset-2">full guide</Link>.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <Section icon={<Terminal className="h-4 w-4" />} title="Your command" hint="Answer four questions; copy the command; run it in a terminal.">
            <div className="space-y-4">
              <Field label="Folder of your repository" hint="Quoted for you if it has spaces. Leave empty for the folder you are in.">
                {(id) => <TextInput id={id} value={dir} onChange={setDir} placeholder="./my-repo" spellCheck={false} autoComplete="off" />}
              </Field>
              <Toggle checked={write} onChange={setWrite} label="Write the files" hint="Off: a dry run that only shows what it found. Run that first." />
              <Field label="AI agent for spec, implement and onboard" hint="Can be changed later with ./.ai/sdlc agent. Agents that are not installed are listed with how to install them.">
                {(id) => <Select id={id} value={agentPreset} onChange={setAgentPreset} options={AGENT_OPTIONS} />}
              </Field>
              <Toggle checked={leaveAgentsMd} onChange={setLeaveAgentsMd} label="Write only inside .ai/" hint="Leaves AGENTS.md alone. Agents opened on the folder then will not find the .ai/ instructions by themselves." />
              <Toggle checked={force} onChange={setForce} label="Overwrite files this tool wrote earlier" hint="For running it again after an upgrade. Files you wrote yourself are never overwritten." />
              <CopyBlock code={command} label="adopt command" />
              <p className="text-[11px] text-zinc-500">
                Windows: the same command works in PowerShell or cmd. Afterwards use <code className="font-mono">.\.ai\sdlc.cmd</code> where the steps say <code className="font-mono">./.ai/sdlc</code>.
              </p>
            </div>
          </Section>
        </div>

        <div className="min-w-0 lg:col-span-7">
          <Section icon={<ListChecks className="h-4 w-4" />} title="The whole workflow, step by step">
            <ol className="space-y-5">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-indigo-500/40 bg-indigo-600/20 text-xs font-semibold text-indigo-300" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="text-sm font-semibold text-zinc-100">{step.title}</h3>
                    <p className="text-xs leading-6 text-zinc-400">{step.text}</p>
                    <CopyBlock code={step.code} label={step.label} />
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section icon={<ShieldCheck className="h-4 w-4" />} title="What “done” means for existing code" hint="Existing code is rarely green, so the bar is the day you adopted it, not perfection.">
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">How each check is judged against the baseline</caption>
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">At adoption</th>
                  <th scope="col" className="px-3 py-2 font-medium">Now</th>
                  <th scope="col" className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {RATCHET.map((row) => (
                  <tr key={`${row.then}-${row.now}`} className="border-t border-zinc-800">
                    <td className="px-3 py-2">{row.then}</td>
                    <td className="px-3 py-2">{row.now}</td>
                    <td className="px-3 py-2">{row.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-1.5 text-xs leading-6 text-zinc-400">
            <li className="flex gap-2"><AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden /> The baseline is per check, not per violation: a check that was already red can get worse without being noticed. Tighten as checks turn green.</li>
            <li className="flex gap-2"><AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden /> Record the baseline where you verify. A check that passes on your laptop but fails in CI would look like a regression there.</li>
            <li className="flex gap-2"><Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden /> Secrets already in the repository are recorded as known (their text is never copied); a new one fails the secrets check.</li>
          </ul>
        </Section>

        <Section icon={<Package className="h-4 w-4" />} title="What it finds in your repository" hint="It only proposes a check when your repository defines the command itself, and says where it found it. Nothing is guessed.">
          <ul className="space-y-3">
            {DETECTS.map((d) => (
              <li key={d.found} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-6">
                <p className="text-zinc-300">{d.found}</p>
                <p className="mt-1 flex items-start gap-2 text-zinc-400">
                  <ArrowRight className="mt-1.5 h-3 w-3 shrink-0 text-indigo-400" aria-hidden /> {d.becomes}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-zinc-500">Scripts that never end (<code className="font-mono">--watch</code>) and the npm “no test specified” placeholder are not made checks, and the report says so.</p>
        </Section>
      </div>

      <Section
        icon={<FolderTree className="h-4 w-4" />}
        title="What it writes: a worked example"
        hint="This sample repository has a Node app, a Python API, a CLAUDE.md and a CI workflow. The result below is produced live by the same engine the command uses."
      >
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">The checks found in the sample repository and where each came from</caption>
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Stage</th>
                  <th scope="col" className="px-3 py-2 font-medium">Check</th>
                  <th scope="col" className="px-3 py-2 font-medium">Runs</th>
                  <th scope="col" className="px-3 py-2 font-medium">Found in</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {(gates.gates ?? []).map((g) => {
                  const found = SAMPLE_RESULT.detection.gates.find((d) => d.id === g.id)?.evidence ?? "built in";
                  return (
                    <tr key={g.id} className="border-t border-zinc-800 align-top">
                      <td className="px-3 py-2">{g.stage}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{g.id}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{g.cmd}{g.cwd === "." ? "" : ` (in ${g.cwd})`}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400">{found}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {SAMPLE_RESULT.detection.notCovered.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-6 text-zinc-400">
              <p className="mb-1 flex items-center gap-2 font-medium text-zinc-300"><CircleX className="h-3.5 w-3.5 text-amber-400" aria-hidden /> Not covered (it will not pretend)</p>
              <ul className="list-disc space-y-1 pl-5">
                {SAMPLE_RESULT.detection.notCovered.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-zinc-400">
            {SAMPLE_FILES.length} files, all inside <code className="font-mono">.ai/</code> except one marked block in <code className="font-mono">AGENTS.md</code>. Open any of them:
          </p>
          <FileExplorer files={SAMPLE_FILES} initialPath=".ai/README.md" />
        </div>
      </Section>

      <Section icon={<ListChecks className="h-4 w-4" />} title="Good to know">
        <ul className="grid gap-3 text-xs leading-6 text-zinc-400 md:grid-cols-2">
          <li><strong className="text-zinc-200">Your CI is left alone.</strong> It does not know about the baseline; the generated .ai/README.md has the small job to add.</li>
          <li><strong className="text-zinc-200">Existing agent files stay.</strong> CLAUDE.md, .cursor/rules and similar are pointed to, never replaced. Claude Code reads CLAUDE.md, so add the line <code className="font-mono">@AGENTS.md</code> to it.</li>
          <li><strong className="text-zinc-200">Agents are fenced in.</strong> They may not edit the checks, the baseline, your workflows or (while fixing) the specification; the loop stops if they do.</li>
          <li><strong className="text-zinc-200">Running it again is safe.</strong> Nothing changes when nothing changed, and files you edited are kept.</li>
          <li><strong className="text-zinc-200">Tested on</strong> Node and Python projects, throwaway repositories and this tool’s own repository. Not yet on Windows, and not on third-party repositories.</li>
          <li><strong className="text-zinc-200">Starting a brand-new project instead?</strong> Use the <Link href="/" className="text-indigo-300 underline underline-offset-2">New project</Link> page.</li>
        </ul>
      </Section>
    </div>
  );
}
