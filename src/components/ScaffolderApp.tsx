"use client";

import React, { useMemo, useState } from "react";
import {
  Box,
  Check,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  FileCode2,
  FolderTree,
  GitBranch,
  Layers,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Terminal,
  Globe,
} from "lucide-react";
import {
  ArchitectureType,
  AuthType,
  BackendLang,
  CacheType,
  CiProvider,
  DatabaseType,
  FrontendFramework,
  MobileFramework,
  ScaffolderConfig,
} from "@/lib/types";
import {
  generateCiYaml,
  generateDirectoryTree,
  generateDockerCompose,
  generateFeatureRunner,
  generateInitScript,
  sanitizeName,
} from "@/lib/generators";

type ArtifactTab = "init" | "feature" | "docker" | "ci" | "tree";

const BACKEND_OPTIONS: Record<
  BackendLang,
  { label: string; frameworks: string[]; versions: string[] }
> = {
  python: {
    label: "Python",
    frameworks: ["FastAPI", "Django Ninja", "Flask"],
    versions: ["3.12", "3.11", "3.13", "3.10"],
  },
  java: {
    label: "Java",
    frameworks: ["Spring Boot 3.3", "Quarkus", "Micronaut"],
    versions: ["21", "17"],
  },
  node: {
    label: "Node.js",
    frameworks: ["NestJS", "Fastify", "Express"],
    versions: ["22", "20"],
  },
  go: {
    label: "Go",
    frameworks: ["Gin", "Fiber", "Chi"],
    versions: ["1.23", "1.22"],
  },
};

export default function ScaffolderApp() {
  const [config, setConfig] = useState<ScaffolderConfig>({
    projectName: "acme-platform",
    architecture: "fullstack-mobile",
    includeBackend: true,
    backendLang: "python",
    backendFramework: "FastAPI",
    backendVersion: "3.12",
    database: "postgres",
    cache: "redis",
    auth: "jwt",
    includeWeb: true,
    webFramework: "vue",
    webTypescript: true,
    includeMobile: true,
    mobileFramework: "flutter",
    mobileStateMgmt: "BLoC",
    includeDocker: true,
    ciProvider: "github-actions",
    maxHealingLoops: 3,
  });

  const [activeTab, setActiveTab] = useState<ArtifactTab>("init");
  const [copied, setCopied] = useState(false);

  const handleArchitecturePreset = (arch: ArchitectureType) => {
    if (arch === "microservice") {
      setConfig((prev) => ({
        ...prev,
        architecture: arch,
        includeBackend: true,
        includeWeb: false,
        includeMobile: false,
      }));
    } else if (arch === "fullstack") {
      setConfig((prev) => ({
        ...prev,
        architecture: arch,
        includeBackend: true,
        includeWeb: true,
        includeMobile: false,
      }));
    } else if (arch === "fullstack-mobile") {
      setConfig((prev) => ({
        ...prev,
        architecture: arch,
        includeBackend: true,
        includeWeb: true,
        includeMobile: true,
      }));
    } else {
      setConfig((prev) => ({
        ...prev,
        architecture: arch,
        includeBackend: true,
        includeWeb: true,
        includeMobile: false,
      }));
    }
  };

  const handleBackendLangChange = (lang: BackendLang) => {
    const meta = BACKEND_OPTIONS[lang];
    setConfig((prev) => ({
      ...prev,
      backendLang: lang,
      backendFramework: meta.frameworks[0],
      backendVersion: meta.versions[0],
    }));
  };

  const artifacts = useMemo(() => {
    return {
      init: generateInitScript(config),
      feature: generateFeatureRunner(config),
      docker: generateDockerCompose(config),
      ci: generateCiYaml(config),
      tree: generateDirectoryTree(config),
    };
  }, [config]);

  const currentContent = artifacts[activeTab];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const filenameMap: Record<ArtifactTab, string> = {
      init: "init-project.sh",
      feature: "feature-runner.sh",
      docker: "docker-compose.yml",
      ci: "ci.yml",
      tree: `${sanitizeName(config.projectName)}-structure.txt`,
    };
    const blob = new Blob([currentContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameMap[activeTab];
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                AI SDLC Project Scaffolder
              </h1>
              <p className="text-xs text-zinc-400">
                Standardized Boilerplate + 4-Phase Loop Engineering Generator
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3.5 h-3.5" />
              PRD &rarr; Contract &rarr; Code &rarr; Loop
            </span>
          </div>
        </div>
      </header>

      {/* Main Split Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Configuration Form */}
        <div className="lg:col-span-5 space-y-5">
          {/* 1. Project Identity & Topology */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>1. Project Topology</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Repository / Project Slug
              </label>
              <input
                type="text"
                value={config.projectName}
                onChange={(e) =>
                  setConfig({ ...config, projectName: e.target.value })
                }
                placeholder="e.g. payment-hub-service"
                className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Architecture Pattern
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      id: "microservice",
                      title: "Microservice",
                      desc: "Backend API only",
                    },
                    {
                      id: "fullstack",
                      title: "Full-Stack Web",
                      desc: "Backend + Web UI",
                    },
                    {
                      id: "fullstack-mobile",
                      title: "Omnichannel",
                      desc: "Backend + Web + Mobile",
                    },
                    {
                      id: "monolith",
                      title: "Modular Monolith",
                      desc: "Unified src/ tree",
                    },
                  ] as const
                ).map((item) => {
                  const selected = config.architecture === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleArchitecturePreset(item.id)}
                      className={`text-left p-2.5 rounded-lg border transition ${
                        selected
                          ? "bg-indigo-600/15 border-indigo-500 text-zinc-100"
                          : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <div className="text-xs font-semibold">{item.title}</div>
                      <div className="text-[11px] opacity-75">{item.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 2. Backend Service Configuration */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Server className="w-4 h-4 text-emerald-400" />
                <span>2. Backend Runtime</span>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeBackend}
                  onChange={(e) =>
                    setConfig({ ...config, includeBackend: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-950 text-indigo-500 focus:ring-0"
                />
                Enable
              </label>
            </div>

            {config.includeBackend && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(BACKEND_OPTIONS) as BackendLang[]).map(
                    (lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => handleBackendLangChange(lang)}
                        className={`py-1.5 px-2 rounded-md text-xs font-medium border transition ${
                          config.backendLang === lang
                            ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-300"
                            : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                        }`}
                      >
                        {BACKEND_OPTIONS[lang].label}
                      </button>
                    )
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Framework
                    </label>
                    <select
                      value={config.backendFramework}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          backendFramework: e.target.value,
                        })
                      }
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-2 text-xs text-zinc-100"
                    >
                      {BACKEND_OPTIONS[config.backendLang].frameworks.map(
                        (fw) => (
                          <option key={fw} value={fw}>
                            {fw}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Runtime Version
                    </label>
                    <select
                      value={config.backendVersion}
                      onChange={(e) =>
                        setConfig({ ...config, backendVersion: e.target.value })
                      }
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-2 text-xs text-zinc-100"
                    >
                      {BACKEND_OPTIONS[config.backendLang].versions.map(
                        (ver) => (
                          <option key={ver} value={ver}>
                            {BACKEND_OPTIONS[config.backendLang].label} {ver}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Database
                    </label>
                    <select
                      value={config.database}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          database: e.target.value as DatabaseType,
                        })
                      }
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-100"
                    >
                      <option value="postgres">PostgreSQL 16</option>
                      <option value="mysql">MySQL 8.4</option>
                      <option value="mongodb">MongoDB 7</option>
                      <option value="sqlite">SQLite</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Cache / Broker
                    </label>
                    <select
                      value={config.cache}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          cache: e.target.value as CacheType,
                        })
                      }
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-100"
                    >
                      <option value="redis">Redis 7</option>
                      <option value="none">None</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Auth Strategy
                    </label>
                    <select
                      value={config.auth}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          auth: e.target.value as AuthType,
                        })
                      }
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-100"
                    >
                      <option value="jwt">JWT Bearer</option>
                      <option value="keycloak">Keycloak OIDC</option>
                      <option value="session">Session Cookie</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 3. Web Frontend Configuration */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Globe className="w-4 h-4 text-sky-400" />
                <span>3. Web Frontend</span>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeWeb}
                  onChange={(e) =>
                    setConfig({ ...config, includeWeb: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-950 text-indigo-500 focus:ring-0"
                />
                Enable
              </label>
            </div>

            {config.includeWeb && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      { id: "vue", label: "Vue 3" },
                      { id: "nextjs", label: "Next.js" },
                      { id: "nuxt", label: "Nuxt 3" },
                      { id: "react", label: "React" },
                    ] as { id: FrontendFramework; label: string }[]
                  ).map((fw) => (
                    <button
                      key={fw.id}
                      type="button"
                      onClick={() =>
                        setConfig({ ...config, webFramework: fw.id })
                      }
                      className={`py-1.5 px-2 rounded-md text-xs font-medium border transition ${
                        config.webFramework === fw.id
                          ? "bg-sky-500/15 border-sky-500/60 text-sky-300"
                          : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      {fw.label}
                    </button>
                  ))}
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.webTypescript}
                    onChange={(e) =>
                      setConfig({ ...config, webTypescript: e.target.checked })
                    }
                    className="rounded border-zinc-700 bg-zinc-950 text-sky-500 focus:ring-0"
                  />
                  Enforce Strict TypeScript in AI Rules &amp; CI
                </label>
              </div>
            )}
          </section>

          {/* 4. Mobile App Configuration */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Smartphone className="w-4 h-4 text-amber-400" />
                <span>4. Mobile Client</span>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeMobile}
                  onChange={(e) =>
                    setConfig({ ...config, includeMobile: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-950 text-indigo-500 focus:ring-0"
                />
                Enable
              </label>
            </div>

            {config.includeMobile && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Mobile SDK
                  </label>
                  <select
                    value={config.mobileFramework}
                    onChange={(e) => {
                      const val = e.target.value as MobileFramework;
                      setConfig({
                        ...config,
                        mobileFramework: val,
                        mobileStateMgmt: val === "flutter" ? "BLoC" : "Zustand",
                      });
                    }}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-2 text-xs text-zinc-100"
                  >
                    <option value="flutter">Flutter (Dart 3+)</option>
                    <option value="react-native">React Native (Expo)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    State Architecture
                  </label>
                  <select
                    value={config.mobileStateMgmt}
                    onChange={(e) =>
                      setConfig({ ...config, mobileStateMgmt: e.target.value })
                    }
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-2 text-xs text-zinc-100"
                  >
                    {config.mobileFramework === "flutter" ? (
                      <>
                        <option value="BLoC">BLoC / Cubit</option>
                        <option value="Riverpod">Riverpod</option>
                      </>
                    ) : (
                      <>
                        <option value="Zustand">Zustand</option>
                        <option value="Redux Toolkit">Redux Toolkit</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
            )}
          </section>

          {/* 5. DevOps & Loop Engineering */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <RefreshCw className="w-4 h-4 text-purple-400" />
              <span>5. DevOps &amp; Loop Engineering</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  CI/CD Pipeline
                </label>
                <select
                  value={config.ciProvider}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      ciProvider: e.target.value as CiProvider,
                    })
                  }
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-2 text-xs text-zinc-100"
                >
                  <option value="github-actions">GitHub Actions</option>
                  <option value="gitlab-ci">GitLab CI</option>
                  <option value="none">None</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Max Self-Healing Loops
                </label>
                <select
                  value={config.maxHealingLoops}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      maxHealingLoops: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-2 text-xs text-zinc-100"
                >
                  <option value={2}>2 Iterations</option>
                  <option value={3}>3 Iterations (Recommended)</option>
                  <option value={5}>5 Iterations</option>
                </select>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.includeDocker}
                onChange={(e) =>
                  setConfig({ ...config, includeDocker: e.target.checked })
                }
                className="rounded border-zinc-700 bg-zinc-950 text-purple-500 focus:ring-0"
              />
              Generate Multi-Stage Dockerfiles &amp; docker-compose.yml
            </label>
          </section>
        </div>

        {/* Right Column: Live Output & Script Artifacts */}
        <div className="lg:col-span-7 flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          {/* Artifact Tabs */}
          <div className="border-b border-zinc-800 bg-zinc-950/80 px-3 pt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 overflow-x-auto">
              {(
                [
                  { id: "init", label: "init-project.sh", icon: Terminal },
                  { id: "feature", label: "feature-runner.sh", icon: Play },
                  { id: "tree", label: "Folder Tree", icon: FolderTree },
                  { id: "docker", label: "docker-compose.yml", icon: Box },
                  { id: "ci", label: "ci.yml", icon: GitBranch },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition whitespace-nowrap ${
                      active
                        ? "border-indigo-500 text-indigo-300 bg-zinc-900"
                        : "border-transparent text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pb-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
            </div>
          </div>

          {/* Code / Tree Preview Window */}
          <div className="flex-1 p-4 overflow-auto bg-zinc-950 font-mono text-xs leading-relaxed text-zinc-300 max-h-[720px]">
            <pre className="whitespace-pre">{currentContent}</pre>
          </div>

          {/* Quick Execution Footer */}
          <div className="border-t border-zinc-800 bg-zinc-900/90 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                Run{" "}
                <code className="px-1.5 py-0.5 rounded bg-zinc-950 text-zinc-200 border border-zinc-800">
                  chmod +x init-project.sh && ./init-project.sh
                </code>{" "}
                to bootstrap locally.
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Code2 className="w-3.5 h-3.5" />
              <span>Ready for Vercel</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
