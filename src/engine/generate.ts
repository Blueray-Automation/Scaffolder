import { stringify } from "yaml";
import { buildCdWorkflow, buildCiWorkflow } from "./ci";
import { buildCompose, buildEnvExample } from "./compose";
import { hasErrors, resolveConfig, validateConfig, type Issue, type ScaffolderConfig } from "./config";
import { renderTemplate } from "./render";
import { buildSdlcConfig } from "./sdlcConfig";
import { TEMPLATE_FILES } from "./templates.generated";
import { buildView } from "./view";

export interface GeneratedFile {
  path: string;
  content: string;
  executable: boolean;
}

export interface GenerateResult {
  config: ScaffolderConfig;
  issues: Issue[];
  files: GeneratedFile[];
}

interface Mount {
  /** Folder inside the pack's template dir. "" = the whole pack dir. */
  from: string;
  /** Destination directory in the generated repo. "" = repo root. */
  to: (cfg: ScaffolderConfig) => string;
}

interface Pack {
  id: string;
  dir: string;
  enabled: (cfg: ScaffolderConfig) => boolean;
  mounts: Mount[];
  /** Per-file filter; `rel` is the path inside the mount without the .tmpl suffix. */
  include?: (rel: string, cfg: ScaffolderConfig) => boolean;
}

const root = () => "";

/**
 * Stack packs. A new language/framework is a new entry here plus a template
 * folder; validation (capabilities.ts) decides when it becomes selectable.
 */
const PACKS: Pack[] = [
  { id: "core", dir: "core", enabled: () => true, mounts: [{ from: "", to: root }] },
  {
    id: "backend-python-fastapi",
    dir: "backend-python-fastapi",
    enabled: (c) => c.backend.enabled && c.backend.language === "python" && c.backend.framework === "fastapi",
    mounts: [
      { from: "service/", to: (c) => c.layout.backendDir },
      { from: "repo/", to: root },
    ],
    include: (rel, c) => {
      const base = rel.split("/").pop() ?? rel;
      if (!c.docker.enabled && (base === "Dockerfile" || base === ".dockerignore")) return false;
      if (c.database.type === "none" && rel.startsWith("app/db/")) return false;
      if (c.database.type === "none" && rel === "tests/test_db.py") return false;
      return true;
    },
  },
  {
    id: "web-nextjs",
    dir: "web-nextjs",
    enabled: (c) => c.web.enabled && c.web.framework === "nextjs",
    mounts: [
      { from: "service/", to: (c) => c.layout.webDir },
      { from: "repo/", to: root },
    ],
    include: (rel, c) => {
      const base = rel.split("/").pop() ?? rel;
      return !(!c.docker.enabled && (base === "Dockerfile" || base === ".dockerignore"));
    },
  },
  {
    id: "github",
    dir: "github",
    enabled: (c) => c.ci.provider === "github-actions",
    mounts: [{ from: "", to: root }],
  },
  {
    id: "deploy",
    dir: "deploy",
    enabled: (c) => c.cd.enabled,
    mounts: [{ from: "", to: root }],
    include: (rel, c) => {
      const m = rel.match(/^deploy\/targets\/(.+)\.sh$/);
      return !m || m[1] === c.cd.target || m[1] === "none";
    },
  },
];

const EXEC = [/\.sh$/, /^scripts\/sdlc$/, /^scripts\/sdlc\.py$/];

function isExecutable(path: string): boolean {
  return EXEC.some((re) => re.test(path));
}

/** Windows batch files must use CRLF line endings (labels and `goto` can misbehave with bare LF); everything else stays LF. */
function withLineEndings(path: string, content: string): string {
  return /\.(cmd|bat)$/i.test(path) ? content.replace(/\r?\n/g, "\r\n") : content;
}

function join(dir: string, rel: string): string {
  return dir ? `${dir}/${rel}` : rel;
}

function renderPack(pack: Pack, cfg: ScaffolderConfig, view: Record<string, unknown>): GeneratedFile[] {
  const out: GeneratedFile[] = [];
  const prefix = `${pack.dir}/`;
  for (const [key, tpl] of Object.entries(TEMPLATE_FILES)) {
    if (!key.startsWith(prefix)) continue;
    const inPack = key.slice(prefix.length);
    // Longest matching mount wins ("" matches everything).
    const mount = [...pack.mounts].sort((a, b) => b.from.length - a.from.length).find((m) => inPack.startsWith(m.from));
    if (!mount) continue;
    const rel = inPack.slice(mount.from.length).replace(/\.tmpl$/, "");
    if (pack.include && !pack.include(rel, cfg)) continue;
    const path = join(mount.to(cfg), rel);
    out.push({
      path,
      content: withLineEndings(path, renderTemplate(tpl.content, view, key)),
      executable: isExecutable(path),
    });
  }
  return out;
}

export function configToYaml(cfg: ScaffolderConfig): string {
  return (
    "# Scaffolder config. Regenerate or diff with:  scaffolder generate --config scaffolder.config.yaml --out <dir>\n" +
    stringify(cfg, { lineWidth: 0 })
  );
}

/** Generate the full project as an in-memory file list. Pure: no filesystem access. */
export function generateProject(input: unknown = {}): GenerateResult {
  const config = resolveConfig(input);
  const issues = validateConfig(config);
  if (hasErrors(issues)) return { config, issues, files: [] };

  const view = buildView(config);
  const files: GeneratedFile[] = [];
  for (const pack of PACKS) {
    if (pack.enabled(config)) files.push(...renderPack(pack, config, view));
  }

  const add = (path: string, content: string) => files.push({ path, content, executable: isExecutable(path) });
  add("scaffolder.config.yaml", configToYaml(config));
  add(".ai/sdlc.json", JSON.stringify(buildSdlcConfig(config), null, 2) + "\n");
  if (config.docker.enabled) add("docker-compose.yml", buildCompose(config));
  add(".env.example", buildEnvExample(config));
  if (config.ci.provider === "github-actions") {
    add(".github/workflows/ci.yml", buildCiWorkflow(config));
    if (config.cd.enabled) add(".github/workflows/cd.yml", buildCdWorkflow(config));
  }

  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) throw new Error(`Two sources generated the same file: ${f.path}`);
    seen.add(f.path);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { config, issues, files };
}
