"use client";

import React, { useDeferredValue, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CircleAlert, Copy, Cpu, Download, FileCog, FolderTree, Terminal, Upload } from "lucide-react";
import { parse } from "yaml";
import {
  configToYaml,
  deepMerge,
  defaultConfig,
  generateProject,
  hasErrors,
  resolveConfig,
  toZip,
  type GenerateResult,
  type ScaffolderConfig,
} from "@/engine";
import { cx, downloadBlob } from "@/lib/utils";
import { ConfigForm } from "./ConfigForm";
import { FileExplorer } from "./FileExplorer";
import { Badge, Button } from "./ui";

type Tab = "files" | "config" | "cli";

const PRESETS: Array<{ id: string; label: string; hint: string; patch: Record<string, unknown> }> = [
  { id: "fullstack", label: "Full-stack", hint: "FastAPI + Next.js + PostgreSQL", patch: {} },
  { id: "api", label: "API + database", hint: "FastAPI + PostgreSQL", patch: { web: { enabled: false } } },
  { id: "api-lite", label: "API only", hint: "FastAPI, no database", patch: { web: { enabled: false }, database: { type: "none" } } },
];

function safeGenerate(config: ScaffolderConfig): { result?: GenerateResult; crash?: string } {
  try {
    return { result: generateProject(config) };
  } catch (e) {
    return { crash: e instanceof Error ? e.message : String(e) };
  }
}

export default function ScaffolderApp() {
  const [config, setConfig] = useState<ScaffolderConfig>(() => defaultConfig());
  const [tab, setTab] = useState<Tab>("files");
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const deferred = useDeferredValue(config);
  const { result, crash } = useMemo(() => safeGenerate(deferred), [deferred]);
  const resolved = useMemo(() => resolveConfig(deferred), [deferred]);
  const yaml = useMemo(() => configToYaml(resolved), [resolved]);

  const issues = result?.issues ?? [];
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const files = result?.files ?? [];
  const ready = !crash && result && !hasErrors(issues);
  const slug = resolved.project.name;

  const downloadZip = () => {
    if (!ready) return;
    downloadBlob(toZip(files, slug) as BlobPart, `${slug}.zip`, "application/zip");
  };

  const copyYaml = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = parse(await file.text());
      setConfig(resolveConfig(parsed ?? {}));
      setLoadError(null);
    } catch (e) {
      setLoadError(`Could not read ${file.name}: ${e instanceof Error ? e.message : "invalid YAML"}`);
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "files", label: `Files${ready ? ` (${files.length})` : ""}`, icon: <FolderTree className="h-3.5 w-3.5" /> },
    { id: "config", label: "scaffolder.config.yaml", icon: <FileCog className="h-3.5 w-3.5" /> },
    { id: "cli", label: "Command line", icon: <Terminal className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-600/20 text-indigo-400">
              <Cpu className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">Scaffolder</h1>
              <p className="text-xs text-zinc-400">AI-ready projects, verified end to end</p>
            </div>
          </div>
          <ol className="hidden items-center gap-1.5 text-xs text-zinc-400 md:flex" aria-label="Pipeline">
            {["PRD", "Code", "Test", "Deploy"].map((step, i) => (
              <li key={step} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>→</span>}
                <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-200">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="mb-2 text-xs font-medium text-zinc-400">Start from</p>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setConfig(deepMerge(defaultConfig(), p.patch))}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-left transition-colors hover:border-indigo-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                >
                  <span className="block text-xs font-semibold text-zinc-100">{p.label}</span>
                  <span className="block text-[11px] text-zinc-500">{p.hint}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={() => fileInput.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Load config
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".yaml,.yml,.json"
                className="sr-only"
                aria-label="Load a scaffolder config file"
                onChange={(e) => {
                  void loadFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button variant="ghost" onClick={() => setConfig(defaultConfig())}>
                Reset
              </Button>
              {loadError && <span className="text-xs text-red-400" role="alert">{loadError}</span>}
            </div>
          </div>

          <ConfigForm config={config} onChange={setConfig} issues={issues} />
        </div>

        <div className="space-y-4 lg:col-span-7">
          <div className="lg:sticky lg:top-20 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                {crash ? (
                  <Badge tone="bad"><CircleAlert className="h-3.5 w-3.5" /> Generator error</Badge>
                ) : ready ? (
                  <Badge tone="ok"><Check className="h-3.5 w-3.5" /> {files.length} files ready</Badge>
                ) : (
                  <Badge tone="bad"><CircleAlert className="h-3.5 w-3.5" /> {errors.length} problem{errors.length === 1 ? "" : "s"} to fix</Badge>
                )}
                {warnings.length > 0 && <Badge tone="warn"><AlertTriangle className="h-3.5 w-3.5" /> {warnings.length} warning{warnings.length === 1 ? "" : "s"}</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={copyYaml}>
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy config"}
                </Button>
                <Button onClick={() => downloadBlob(yaml, "scaffolder.config.yaml", "text/yaml")}>
                  <Download className="h-3.5 w-3.5" /> Config
                </Button>
                <Button variant="primary" onClick={downloadZip} disabled={!ready}>
                  <Download className="h-3.5 w-3.5" /> Download {slug}.zip
                </Button>
              </div>
            </div>

            {(errors.length > 0 || warnings.length > 0 || crash) && (
              <ul className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs" aria-label="Configuration problems">
                {crash && <li className="text-red-300">Template error: {crash}</li>}
                {issues.map((i, n) => (
                  <li key={`${i.path}-${n}`} className={cx("flex gap-2", i.level === "error" ? "text-red-300" : "text-amber-300")}>
                    <span className="font-mono text-zinc-500">{i.path}</span>
                    <span>{i.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <div role="tablist" aria-label="Output" className="flex gap-1 border-b border-zinc-800">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
                    tab === t.id ? "border-indigo-500 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === "files" &&
                (ready ? (
                  <FileExplorer files={files} />
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                    Fix the highlighted problems to preview the generated project.
                  </div>
                ))}
              {tab === "config" && (
                <pre tabIndex={0} aria-label="scaffolder.config.yaml" className="max-h-[40rem] overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-200">
                  {yaml}
                </pre>
              )}
              {tab === "cli" && (
                <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
                  <p>Generate the same project from a terminal or CI (same engine as this page):</p>
                  <pre className="overflow-auto rounded-lg bg-zinc-900 p-3 font-mono text-[12px] text-zinc-200">{`npm run scaffold -- init                      # writes scaffolder.config.yaml
npm run scaffold -- generate \\
  --config scaffolder.config.yaml --out ../${slug}
# override anything without editing the file:
npm run scaffold -- generate --config scaffolder.config.yaml \\
  --set sdlc.maxIterations=8 --set web.enabled=false --out ../${slug}`}</pre>
                  <p>Then, inside the generated project:</p>
                  <pre className="overflow-auto rounded-lg bg-zinc-900 p-3 font-mono text-[12px] text-zinc-200">{`cd ../${slug}
./scripts/sdlc doctor    # toolchain ok?
./scripts/sdlc setup     # install dependencies
./scripts/sdlc verify    # gates + PRD facts: exactly what CI runs

# Windows (PowerShell or cmd): the same commands with the .cmd launcher
.\\scripts\\sdlc.cmd doctor`}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
