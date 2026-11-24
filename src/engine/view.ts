import { CAPABILITIES, findOption } from "./capabilities";
import { agentCommand, type ScaffolderConfig } from "./config";
import { TOKENS_PATH } from "./design";
import { mobileStack } from "./mobileStacks";
import { webStack } from "./webStacks";
import { buildGates, OPENAPI_SNAPSHOT, relativeFrom, setupSteps, STAGE_ORDER } from "./gates";

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** `AC-007`, `CHK-009`: the ids a spec uses, always three digits. */
const specId = (prefix: "AC" | "CHK", n: number) => `${prefix}-${String(n).padStart(3, "0")}`;

/** Values every template can reference as `<% name %>`. */
export function buildView(cfg: ScaffolderConfig) {
  const slug = cfg.project.name;
  const owner = cfg.project.owner.toLowerCase();
  const hasBackend = cfg.backend.enabled;
  const hasWeb = cfg.web.enabled;
  const hasMobile = cfg.mobile.enabled;
  const hasDb = hasBackend && cfg.database.type !== "none";
  const hasDocker = cfg.docker.enabled;
  const hasCi = cfg.ci.provider !== "none";
  const hasCd = cfg.cd.enabled;
  const hasDesign = hasWeb || hasMobile;
  const designTool = cfg.design.tool;

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

  // The mobile app's part of the hello-world spec. Next to a backend it has one criterion (the app and the live API
  // agree); on its own it has the three greeting rules, numbered after the web app's when that has its own three.
  const mobileFirst = !hasBackend && hasWeb ? 3 : 0;

  // Wording that depends on which components exist, computed once instead of as nested conditionals in a dozen templates.
  const auditGates = [hasBackend && "`backend.audit`", hasWeb && "`web.audit`"].filter(Boolean) as string[];
  const dartNoAudit = "The Dart SDK has no dependency audit, so read every change to `pubspec.lock` yourself.";
  const auditNote = auditGates.length
    ? `${auditGates.join(" and ")} ${auditGates.length > 1 ? "report" : "reports"} known vulnerabilities (warnings; treat high/critical as blockers).` +
      (hasMobile ? ` ${dartNoAudit}` : "")
    : hasMobile
      ? `There is no audit gate for a Dart project. ${dartNoAudit}`
      : "";
  const coverageSummary = [
    hasBackend && `backend >= ${cfg.sdlc.coverage.backend}%`,
    hasWeb && `web >= ${cfg.sdlc.coverage.web}%`,
    hasMobile && `mobile >= ${cfg.sdlc.coverage.mobile}%`,
  ]
    .filter(Boolean)
    .join(", ");
  const manifests = [hasBackend && "pyproject.toml", hasWeb && "package.json", hasMobile && "pubspec.yaml"].filter(Boolean).join(" / ");

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
    hasMobile,
    hasDb,
    hasDocker,
    hasCi,
    hasCd,
    hasBoth: hasBackend && hasWeb,
    /** A mobile app that talks to the backend (and so has an API client), and one that stands alone. */
    hasMobileApi: hasMobile && hasBackend,
    mobileOnly: hasMobile && !hasBackend && !hasWeb,
    /** Design tokens (and the rule and skill about them): every project with a screen. */
    hasDesign,
    /** The gate that fails on a hard-coded design value, and the PRD's UI & design section (section 6, which moves the ones after it down). */
    designEnforced: hasDesign && cfg.design.enforce,
    hasDesignUrl: cfg.design.url !== "",
    designUrl: cfg.design.url,
    /** "Figma", or "your design tool" when none is named. */
    designToolName: designTool === "none" || designTool === "other" ? "your design tool" : (findOption(CAPABILITIES.designTool, designTool)?.label ?? "your design tool"),
    designToolFigma: designTool === "figma",
    designToolPenpot: designTool === "penpot",
    tokensPath: TOKENS_PATH,
    webTokensFile: `${cfg.layout.webDir}/${webStack(cfg).design.tokensCss}`,
    mobileTokensFile: `${cfg.layout.mobileDir}/${mobileStack(cfg).design.tokensFile}`,
    prdOutOfScopeNo: hasDesign && cfg.design.enforce ? 7 : 6,
    prdVerificationNo: hasDesign && cfg.design.enforce ? 8 : 7,
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
    mobileDir: cfg.layout.mobileDir,
    backendPort: cfg.backend.port,
    webPort: cfg.web.port,
    webName: webStack(cfg).name,
    webDescription: webStack(cfg).description,
    webTypeTool: webStack(cfg).typeTool,
    webRuleFile: `.ai/rules/${webStack(cfg).ruleFile}`,
    mobileName: mobileStack(cfg).name,
    mobileDescription: mobileStack(cfg).description,
    mobileTool: mobileStack(cfg).tool,
    mobileRuleFile: `.ai/rules/${mobileStack(cfg).ruleFile}`,
    mobileVersion: cfg.mobile.version,
    /** The Dart language version that release line ships with, for `pubspec.yaml`. */
    dartVersion: mobileStack(cfg).languageSdk[cfg.mobile.version] ?? "",
    /** The Dart package name (a Dart identifier: lowercase letters, digits and underscores). */
    dartPackage: slug.replace(/-/g, "_"),
    auditNote,
    coverageSummary,
    manifests,
    /** The rules file that describes how the app a person sees is built: the web app's, else the mobile app's. */
    clientRuleFile: hasWeb || !hasMobile ? `.ai/rules/${webStack(cfg).ruleFile}` : `.ai/rules/${mobileStack(cfg).ruleFile}`,
    /** The YAML form of the description (quoted and escaped), for `pubspec.yaml`. */
    descriptionYaml: JSON.stringify(cfg.project.description),
    mobileAcApi: specId("AC", 8),
    mobileChkApi: specId("CHK", 9),
    mobileAc1: specId("AC", mobileFirst + 1),
    mobileAc2: specId("AC", mobileFirst + 2),
    mobileAc3: specId("AC", mobileFirst + 3),
    mobileChk1: specId("CHK", mobileFirst + 1),
    mobileChk2: specId("CHK", mobileFirst + 2),
    mobileChk3: specId("CHK", mobileFirst + 3),
    pythonVersion: cfg.backend.version,
    pythonTarget: `py${cfg.backend.version.replace(".", "")}`,
    nodeVersion: cfg.web.nodeVersion,
    coverageBackend: cfg.sdlc.coverage.backend,
    coverageWeb: cfg.sdlc.coverage.web,
    coverageMobile: cfg.sdlc.coverage.mobile,

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
