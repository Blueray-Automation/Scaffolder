import { agentCommand, type ScaffolderConfig } from "./config";
import { buildGates, OPENAPI_SNAPSHOT, relativeFrom, setupSteps, STAGE_ORDER } from "./gates";

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Values every template can reference as `<% name %>`. */
export function buildView(cfg: ScaffolderConfig) {
  const slug = cfg.project.name;
  const owner = cfg.project.owner.toLowerCase();
  const hasBackend = cfg.backend.enabled;
  const hasWeb = cfg.web.enabled;
  const hasDb = hasBackend && cfg.database.type !== "none";
  const hasDocker = cfg.docker.enabled;
  const hasCi = cfg.ci.provider !== "none";
  const hasCd = cfg.cd.enabled;

  const db = {
    type: cfg.database.type,
    version: cfg.database.version,
    name: slug.replace(/-/g, "_"),
    user: "app",
    // Development-only credential, safe to commit; real environments inject their own.
    password: "app_password",
    host: "postgres",
    port: 5432,
  };
  const databaseUrlCompose = hasDb
    ? `postgresql+asyncpg://${db.user}:${db.password}@${db.host}:${db.port}/${db.name}`
    : "";
  const databaseUrlLocal = hasDb
    ? `postgresql+asyncpg://${db.user}:${db.password}@localhost:${db.port}/${db.name}`
    : "";

  const gates = buildGates(cfg);
  const gateRows = gates.map((g) => ({
    id: g.id,
    label: g.label,
    stage: g.stage,
    cmd: g.cmd,
    cwd: g.cwd,
    required: g.required,
  }));

  return {
    slug,
    title: titleCase(slug),
    description: cfg.project.description,
    owner: cfg.project.owner,
    ownerLower: owner,
    license: cfg.project.license,
    licenseMit: cfg.project.license === "MIT",
    licenseProprietary: cfg.project.license === "UNLICENSED",
    year: new Date().getUTCFullYear(),
    defaultBranch: cfg.ci.defaultBranch,
    /** Folder that holds the launcher and runner (`<dir>/sdlc`, `<dir>/sdlc.py`): `scripts` in a generated project, `.ai` in an adopted one. */
    sdlcDir: "scripts",

    hasBackend,
    hasWeb,
    hasDb,
    hasDocker,
    hasCi,
    hasCd,
    hasBoth: hasBackend && hasWeb,
    hasSecurity: cfg.sdlc.gates.security,
    hasContract: hasBackend && cfg.sdlc.gates.contract,
    hasFacts: cfg.sdlc.gates.facts,
    runtimeDocker: cfg.sdlc.runtime === "docker",
    runtimeLocal: cfg.sdlc.runtime === "local",
    runtimeNone: cfg.sdlc.runtime === "none",
    runtimeMode: cfg.sdlc.runtime,

    backendDir: cfg.layout.backendDir,
    openapiFromBackend: relativeFrom(cfg.layout.backendDir, OPENAPI_SNAPSHOT),
    webDir: cfg.layout.webDir,
    backendPort: cfg.backend.port,
    webPort: cfg.web.port,
    pythonVersion: cfg.backend.version,
    pythonTarget: `py${cfg.backend.version.replace(".", "")}`,
    nodeVersion: cfg.web.nodeVersion,
    coverageBackend: cfg.sdlc.coverage.backend,
    coverageWeb: cfg.sdlc.coverage.web,

    db,
    databaseUrlCompose,
    databaseUrlLocal,
    dbImage: `postgres:${cfg.database.version}-alpine`,

    registryHost: "ghcr.io",
    imageBackend: `ghcr.io/${owner}/${slug}-backend`,
    imageWeb: `ghcr.io/${owner}/${slug}-web`,
    cdTarget: cfg.cd.target,
    environments: cfg.cd.environments,
    stagingEnvs: cfg.cd.environments.filter((e) => e.trigger === "push-default-branch"),
    tagEnvs: cfg.cd.environments.filter((e) => e.trigger === "tag"),
    manualEnvs: cfg.cd.environments.filter((e) => e.trigger === "manual"),
    firstEnvironment: cfg.cd.environments[0]?.name ?? "staging",

    maxIterations: cfg.sdlc.maxIterations,
    noProgressLimit: cfg.sdlc.noProgressLimit,
    agentCommand: agentCommand(cfg),
    agentConfigured: agentCommand(cfg).length > 0,
    agentPreset: cfg.sdlc.agent.preset,
    stages: STAGE_ORDER.join(" → "),

    gates: gateRows,
    setup: setupSteps(cfg),
  };
}
