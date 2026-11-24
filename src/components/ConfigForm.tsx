"use client";

import React from "react";
import { Boxes, GitBranch, Layers, Palette, Plus, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { AGENT_PRESETS, CAPABILITIES, type DeployTrigger, type Issue, type ScaffolderConfig } from "@/engine";
import { setIn } from "@/lib/utils";
import { Button, Field, NumberInput, Section, Select, TextInput, Toggle } from "./ui";

interface Props {
  config: ScaffolderConfig;
  onChange: (next: ScaffolderConfig) => void;
  issues: Issue[];
}

const TRIGGERS: Array<{ id: DeployTrigger; label: string }> = [
  { id: "push-default-branch", label: "Push to default branch" },
  { id: "tag", label: "Version tag (v1.2.3)" },
  { id: "manual", label: "Manual dispatch" },
];

const GATE_LABELS: Array<[keyof ScaffolderConfig["sdlc"]["gates"], string, string]> = [
  ["lint", "Lint & format", "ruff, eslint, flutter analyze + dart format"],
  ["types", "Type check", "mypy, tsc, vue-tsc (Dart: analyzed with lint)"],
  ["unit", "Unit tests + coverage floor", "pytest, vitest, flutter test"],
  ["build", "Production build", "next build or nuxt build, flutter build bundle, compose validation"],
  ["contract", "API contract drift", "OpenAPI snapshot"],
  ["facts", "Facts: PRD vs running system", "acceptance.json"],
  ["security", "Security scans", "secrets, pip-audit, npm audit (none for Dart)"],
];

/** The preset's own note, plus how to install it (shown whether or not it is installed where the project will run). */
function agentHint(id: string): string | undefined {
  const preset = AGENT_PRESETS.find((p) => p.id === id);
  if (!preset) return undefined;
  return preset.install ? `${preset.hint} Install: ${preset.install}.` : preset.hint;
}

export function ConfigForm({ config, onChange, issues }: Props) {
  const set = (path: Array<string | number>, value: unknown) => onChange(setIn(config, path, value));
  const err = (path: string) => issues.find((i) => i.level === "error" && i.path === path)?.message;

  const pyFrameworks = CAPABILITIES.backend.languages.find((l) => l.id === config.backend.language)?.frameworks ?? [];
  const pyVersions = pyFrameworks.find((f) => f.id === config.backend.framework)?.versions ?? [];
  const webVersions = CAPABILITIES.web.frameworks.find((f) => f.id === config.web.framework)?.versions ?? [];
  const mobileVersions = CAPABILITIES.mobile.frameworks.find((f) => f.id === config.mobile.framework)?.versions ?? [];
  const dbVersions = CAPABILITIES.database.find((d) => d.id === config.database.type)?.versions ?? [];

  const toOptions = (list: readonly string[]) => list.map((v) => ({ id: v, label: v }));

  return (
    <div className="space-y-5">
      <Section icon={<Layers className="h-4 w-4" />} title="Project" hint="Names the repo, images and docs.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name (slug)" error={err("project.name")}>
            {(id) => <TextInput id={id} value={config.project.name} onChange={(v) => set(["project", "name"], v)} placeholder="hello-scaffold" />}
          </Field>
          <Field label="GitHub owner" hint="Used for ghcr.io/<owner>/..." error={err("project.owner")}>
            {(id) => <TextInput id={id} value={config.project.owner} onChange={(v) => set(["project", "owner"], v)} />}
          </Field>
        </div>
        <Field label="Description">
          {(id) => <TextInput id={id} value={config.project.description} onChange={(v) => set(["project", "description"], v)} />}
        </Field>
        <Field label="License" error={err("project.license")}>
          {(id) => <Select id={id} value={config.project.license} onChange={(v) => set(["project", "license"], v)} options={CAPABILITIES.license} />}
        </Field>
      </Section>

      <Section icon={<Boxes className="h-4 w-4" />} title="Stack" hint="Options marked “coming soon” have no pack yet, so they are not generated as broken stubs.">
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <Toggle checked={config.backend.enabled} onChange={(v) => set(["backend", "enabled"], v)} label="Backend API" />
          {config.backend.enabled && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Language" error={err("backend.language")}>
                {(id) => (
                  <Select
                    id={id}
                    value={config.backend.language}
                    options={CAPABILITIES.backend.languages}
                    onChange={(v) => {
                      const lang = CAPABILITIES.backend.languages.find((l) => l.id === v);
                      const fw = lang?.frameworks.find((f) => f.available) ?? lang?.frameworks[0];
                      onChange({ ...config, backend: { ...config.backend, language: v as never, framework: fw?.id ?? "", version: fw?.versions[0] ?? "" } });
                    }}
                  />
                )}
              </Field>
              <Field label="Framework" error={err("backend.framework")}>
                {(id) => (
                  <Select
                    id={id}
                    value={config.backend.framework}
                    options={pyFrameworks}
                    onChange={(v) => {
                      const fw = pyFrameworks.find((f) => f.id === v);
                      onChange({ ...config, backend: { ...config.backend, framework: v, version: fw?.versions[0] ?? config.backend.version } });
                    }}
                  />
                )}
              </Field>
              <Field label="Version" error={err("backend.version")}>
                {(id) => <Select id={id} value={config.backend.version} options={toOptions(pyVersions)} onChange={(v) => set(["backend", "version"], v)} />}
              </Field>
              <Field label="Port" error={err("backend.port")}>
                {(id) => <NumberInput id={id} value={config.backend.port} onChange={(v) => set(["backend", "port"], v)} />}
              </Field>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <Toggle checked={config.web.enabled} onChange={(v) => set(["web", "enabled"], v)} label="Web app" />
          {config.web.enabled && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Framework" error={err("web.framework")}>
                {(id) => <Select id={id} value={config.web.framework} options={CAPABILITIES.web.frameworks} onChange={(v) => set(["web", "framework"], v)} />}
              </Field>
              <Field label="Node version" error={err("web.nodeVersion")}>
                {(id) => <Select id={id} value={config.web.nodeVersion} options={toOptions(webVersions)} onChange={(v) => set(["web", "nodeVersion"], v)} />}
              </Field>
              <Field label="Port" error={err("web.port")}>
                {(id) => <NumberInput id={id} value={config.web.port} onChange={(v) => set(["web", "port"], v)} />}
              </Field>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <Toggle checked={config.mobile.enabled} onChange={(v) => set(["mobile", "enabled"], v)} label="Mobile app" />
          {config.mobile.enabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Framework" error={err("mobile.framework")}>
                  {(id) => (
                    <Select
                      id={id}
                      value={config.mobile.framework}
                      options={CAPABILITIES.mobile.frameworks}
                      onChange={(v) => {
                        const fw = CAPABILITIES.mobile.frameworks.find((f) => f.id === v);
                        onChange({ ...config, mobile: { ...config.mobile, framework: v as never, version: fw?.versions[0] ?? config.mobile.version } });
                      }}
                    />
                  )}
                </Field>
                <Field label="Version" error={err("mobile.version")}>
                  {(id) => <Select id={id} value={config.mobile.version} options={toOptions(mobileVersions)} onChange={(v) => set(["mobile", "version"], v)} />}
                </Field>
              </div>
              {!config.backend.enabled && !config.web.enabled && (
                <p className="flex items-start gap-2 text-xs text-zinc-500">
                  <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  With only a mobile app there is nothing to put in a container, so Docker and CD are left out.
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Database" error={err("database.type")}>
            {(id) => (
              <Select
                id={id}
                value={config.database.type}
                options={CAPABILITIES.database}
                onChange={(v) => {
                  const versions = CAPABILITIES.database.find((d) => d.id === v)?.versions;
                  onChange({ ...config, database: { type: v as never, version: versions?.[0] ?? config.database.version } });
                }}
              />
            )}
          </Field>
          <Field label="Database version" error={err("database.version")}>
            {(id) => <Select id={id} value={config.database.version} options={toOptions(dbVersions)} onChange={(v) => set(["database", "version"], v)} disabled={dbVersions.length === 0} />}
          </Field>
          <Field label="Cache">
            {(id) => <Select id={id} value={config.cache.type} options={CAPABILITIES.cache} onChange={(v) => set(["cache", "type"], v)} />}
          </Field>
          <Field label="Auth">
            {(id) => <Select id={id} value={config.auth.type} options={CAPABILITIES.auth} onChange={(v) => set(["auth", "type"], v)} />}
          </Field>
        </div>

        <details className="group rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-zinc-400 group-open:mb-3">Layout</summary>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Backend directory" error={err("layout.backendDir")}>
              {(id) => <TextInput id={id} value={config.layout.backendDir} onChange={(v) => set(["layout", "backendDir"], v)} />}
            </Field>
            <Field label="Web directory" error={err("layout.webDir")}>
              {(id) => <TextInput id={id} value={config.layout.webDir} onChange={(v) => set(["layout", "webDir"], v)} />}
            </Field>
            <Field label="Mobile directory" error={err("layout.mobileDir")}>
              {(id) => <TextInput id={id} value={config.layout.mobileDir} onChange={(v) => set(["layout", "mobileDir"], v)} />}
            </Field>
          </div>
        </details>
      </Section>

      {(config.web.enabled || config.mobile.enabled) && (
        <Section
          icon={<Palette className="h-4 w-4" />}
          title="Design"
          hint="The look is a contract: design tokens the screens are built from, a UI & design section in every PRD, and a gate against hard-coded values."
        >
          <Toggle
            checked={config.design.enforce}
            onChange={(v) => set(["design", "enforce"], v)}
            label="Enforce the design contract"
            hint="Fails verification when a screen hard-codes a colour, space, radius or font size, or a PRD has no UI & design section. The tokens are generated either way."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Design tool" error={err("design.tool")} hint={CAPABILITIES.designTool.find((t) => t.id === config.design.tool)?.hint}>
              {(id) => <Select id={id} value={config.design.tool} options={CAPABILITIES.designTool} onChange={(v) => set(["design", "tool"], v)} />}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Link to the design file (optional)" error={err("design.url")} hint="A Figma file, a Penpot project or a style guide. It goes into the PRD template and the project's design guide.">
                {(id) => <TextInput id={id} value={config.design.url} onChange={(v) => set(["design", "url"], v)} placeholder="https://www.figma.com/design/..." spellCheck={false} />}
              </Field>
            </div>
          </div>
        </Section>
      )}

      <Section
        icon={<ShieldCheck className="h-4 w-4" />}
        title="Verification loop"
        hint="How “done” is proven: gates, then PRD facts against the running system, healed by an agent or you."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max iterations" error={err("sdlc.maxIterations")}>
            {(id) => <NumberInput id={id} value={config.sdlc.maxIterations} onChange={(v) => set(["sdlc", "maxIterations"], v)} />}
          </Field>
          <Field label="Stop after N identical failures" error={err("sdlc.noProgressLimit")}>
            {(id) => <NumberInput id={id} value={config.sdlc.noProgressLimit} onChange={(v) => set(["sdlc", "noProgressLimit"], v)} />}
          </Field>
          <Field label="Coverage floor: backend %" error={err("sdlc.coverage.backend")}>
            {(id) => <NumberInput id={id} value={config.sdlc.coverage.backend} onChange={(v) => set(["sdlc", "coverage", "backend"], v)} />}
          </Field>
          <Field label="Coverage floor: web %" error={err("sdlc.coverage.web")}>
            {(id) => <NumberInput id={id} value={config.sdlc.coverage.web} onChange={(v) => set(["sdlc", "coverage", "web"], v)} />}
          </Field>
          <Field label="Coverage floor: mobile %" error={err("sdlc.coverage.mobile")}>
            {(id) => <NumberInput id={id} value={config.sdlc.coverage.mobile} onChange={(v) => set(["sdlc", "coverage", "mobile"], v)} />}
          </Field>
        </div>

        <Field label="Runtime for facts" error={err("sdlc.runtime")} hint={CAPABILITIES.runtime.find((r) => r.id === config.sdlc.runtime)?.hint}>
          {(id) => <Select id={id} value={config.sdlc.runtime} options={CAPABILITIES.runtime} onChange={(v) => set(["sdlc", "runtime"], v)} />}
        </Field>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {GATE_LABELS.map(([key, label, hint]) => (
            <Toggle key={key} checked={config.sdlc.gates[key]} onChange={(v) => set(["sdlc", "gates", key], v)} label={label} hint={hint} />
          ))}
          <Toggle checked={config.sdlc.failFast} onChange={(v) => set(["sdlc", "failFast"], v)} label="Stop at the first failing stage" hint="Gives the agent one focused problem" />
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <p className="text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">You write the PRD and the checks; the agent writes the rest.</span>{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px]">./scripts/sdlc implement FEAT-001</code> gives the agent your spec,
            installs the dependencies it adds, and loops until verified.{" "}
            This is only the project&apos;s default: whoever runs it can see which agents are installed and switch with{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px]">./scripts/sdlc agent</code>.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="AI agent" hint={agentHint(config.sdlc.agent.preset)} error={err("sdlc.agent.preset")}>
                {(id) => <Select id={id} value={config.sdlc.agent.preset} options={AGENT_PRESETS} onChange={(v) => set(["sdlc", "agent", "preset"], v)} />}
              </Field>
            </div>
            <Field label="Agent timeout (s)" error={err("sdlc.agent.timeoutSeconds")}>
              {(id) => <NumberInput id={id} value={config.sdlc.agent.timeoutSeconds} onChange={(v) => set(["sdlc", "agent", "timeoutSeconds"], v)} />}
            </Field>
          </div>
          {config.sdlc.agent.preset !== "none" && (
            <Field
              label={config.sdlc.agent.preset === "custom" ? "Agent command" : "Command override (optional)"}
              hint="Any CLI that reads the prompt on stdin. Leave empty to use the preset's command."
              error={err("sdlc.agent.command")}
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={config.sdlc.agent.command}
                  onChange={(v) => set(["sdlc", "agent", "command"], v)}
                  placeholder={AGENT_PRESETS.find((p) => p.id === config.sdlc.agent.preset)?.command || "e.g. my-agent --prompt-stdin"}
                  spellCheck={false}
                />
              )}
            </Field>
          )}
        </div>
      </Section>

      <Section icon={<GitBranch className="h-4 w-4" />} title="CI / CD" hint="Build once, promote the same image through environments.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="CI provider" error={err("ci.provider")}>
            {(id) => <Select id={id} value={config.ci.provider} options={CAPABILITIES.ci} onChange={(v) => set(["ci", "provider"], v)} />}
          </Field>
          <Field label="Default branch" error={err("ci.defaultBranch")}>
            {(id) => <TextInput id={id} value={config.ci.defaultBranch} onChange={(v) => set(["ci", "defaultBranch"], v)} />}
          </Field>
          <div className="flex items-end pb-2">
            <Toggle checked={config.docker.enabled} onChange={(v) => set(["docker", "enabled"], v)} label="Docker + compose" />
          </div>
        </div>

        <Toggle checked={config.cd.enabled} onChange={(v) => set(["cd", "enabled"], v)} label="Continuous delivery" hint="cd.yml: CI gate, build images once, deploy to environments" />
        {err("cd.enabled") && <p className="text-xs text-red-400">{err("cd.enabled")}</p>}

        {config.cd.enabled && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Registry" error={err("cd.registry")}>
                {(id) => <Select id={id} value={config.cd.registry} options={CAPABILITIES.registry} onChange={(v) => set(["cd", "registry"], v)} />}
              </Field>
              <Field label="Deploy target" error={err("cd.target")}>
                {(id) => <Select id={id} value={config.cd.target} options={CAPABILITIES.deployTarget} onChange={(v) => set(["cd", "target"], v)} />}
              </Field>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400">Environments (deployed in order)</p>
              {config.cd.environments.map((env, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <TextInput aria-label={`Environment ${i + 1} name`} value={env.name} onChange={(v) => set(["cd", "environments", i, "name"], v)} />
                    <Select aria-label={`Environment ${i + 1} trigger`} value={env.trigger} options={TRIGGERS} onChange={(v) => set(["cd", "environments", i, "trigger"], v)} />
                  </div>
                  <div className="flex gap-2">
                    <TextInput aria-label={`Environment ${i + 1} URL`} value={env.url} onChange={(v) => set(["cd", "environments", i, "url"], v)} />
                    <Button
                      variant="ghost"
                      aria-label={`Remove environment ${env.name}`}
                      onClick={() => set(["cd", "environments"], config.cd.environments.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {[`cd.environments[${i}].name`, `cd.environments[${i}].url`, `cd.environments[${i}].trigger`].map(
                    (p) => err(p) && <p key={p} className="text-xs text-red-400">{err(p)}</p>,
                  )}
                </div>
              ))}
              {err("cd.environments") && <p className="text-xs text-red-400">{err("cd.environments")}</p>}
              <Button
                disabled={config.cd.environments.length >= 6}
                onClick={() =>
                  set(["cd", "environments"], [
                    ...config.cd.environments,
                    { name: `env-${config.cd.environments.length + 1}`, url: "https://example.com", trigger: "manual" },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add environment
              </Button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
