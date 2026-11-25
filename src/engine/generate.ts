import { stringify } from "yaml";
import { buildCdWorkflow, buildCiWorkflow } from "./ci";
import { buildCompose, buildEnvExample } from "./compose";
import { hasErrors, resolveConfig, validateConfig, type Issue, type ScaffolderConfig } from "./config";
import { designFiles } from "./design";
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
  /**
   * Only mounted when this holds. Lets a pack keep each variant of a file (with a backend, without one) as its own
   * template folder mounted to the same place, instead of one template full of conditionals.
   */
  when?: (cfg: ScaffolderConfig) => boolean;
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

/** Files that only make sense next to a backend API (paths inside the pack, without .tmpl). */
const CONTRACT_FILES = [".ai/rules/contract.md", ".ai/skills/define-contract/SKILL.md"];
/** Files that only make sense with a screen to style (paths inside the core pack, without .tmpl). */
const DESIGN_FILES = [".ai/rules/design.md", ".ai/skills/implement-ui/SKILL.md", ".ai/design/README.md"];
/** Files that only make sense with a screen that integrates with an API (paths inside the core pack, without .tmpl). */
const API_FILES = [".ai/rules/api-integration.md", ".ai/skills/integrate-api/SKILL.md", ".ai/api/README.md"];
const NEXTJS_API_CLIENT_FILES = ["src/lib/api.ts", "src/__tests__/api.test.ts"];
/** The web app's own greeting logic, used instead of the API client when there is no backend. */
const NEXTJS_STANDALONE_FILES = ["src/lib/greeting.ts", "src/__tests__/greeting.test.ts"];
const NUXT_API_CLIENT_FILES = ["server/utils/api.ts", "server/api/hello.get.ts", "server/__tests__/api.test.ts", "server/__tests__/hello.get.test.ts"];
const NUXT_STANDALONE_FILES = ["app/utils/greeting.ts", "app/__tests__/greeting.test.ts"];

/** The include filter every web pack shares: no Docker files without Docker, and an API client only next to a backend. */
function webInclude(apiClientFiles: string[], standaloneFiles: string[]): Pack["include"] {
  return (rel, c) => {
    const base = rel.split("/").pop() ?? rel;
    if (!c.docker.enabled && (base === "Dockerfile" || base === ".dockerignore")) return false;
    // With a backend the page shows what the API says (a typed client); on its own it has nothing to call.
    if (c.backend.enabled && standaloneFiles.includes(rel)) return false;
    if (!c.backend.enabled && apiClientFiles.includes(rel)) return false;
    return true;
  };
}

/**
 * Stack packs. A new language/framework is a new entry here plus a template
 * folder; validation (capabilities.ts) decides when it becomes selectable.
 */
const PACKS: Pack[] = [
  {
    id: "core",
    dir: "core",
    enabled: () => true,
    mounts: [{ from: "", to: root }],
    // Without a backend there is no API, so no contract to define or guard.
    include: (rel, c) => (c.backend.enabled || !CONTRACT_FILES.includes(rel)) && (c.web.enabled || c.mobile.enabled || !(DESIGN_FILES.includes(rel) || API_FILES.includes(rel))),
  },
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
    include: webInclude(NEXTJS_API_CLIENT_FILES, NEXTJS_STANDALONE_FILES),
  },
  {
    id: "web-nuxt",
    dir: "web-nuxt",
    enabled: (c) => c.web.enabled && c.web.framework === "nuxt",
    mounts: [
      { from: "service/", to: (c) => c.layout.webDir },
      { from: "repo/", to: root },
    ],
    include: webInclude(NUXT_API_CLIENT_FILES, NUXT_STANDALONE_FILES),
  },
  {
    id: "mobile-flutter",
    dir: "mobile-flutter",
    enabled: (c) => c.mobile.enabled && c.mobile.framework === "flutter",
    // The app is plain Dart (the formatter runs on it), so its two shapes are separate folders, not conditionals:
    // next to a backend it asks the API through a typed client; on its own it computes the greeting itself.
    mounts: [
      { from: "service/", to: (c) => c.layout.mobileDir },
      { from: "service-api/", to: (c) => c.layout.mobileDir, when: (c) => c.backend.enabled },
      { from: "service-standalone/", to: (c) => c.layout.mobileDir, when: (c) => !c.backend.enabled },
      { from: "repo/", to: root },
    ],
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

const EXEC = [/\.sh$/, /^scripts\/sdlc$/, /^scripts\/sdlc\.py$/, /^\.ai\/sdlc$/, /^\.ai\/sdlc\.py$/];

export function isExecutable(path: string): boolean {
  return EXEC.some((re) => re.test(path));
}

/** Windows batch files must use CRLF line endings (labels and `goto` can misbehave with bare LF); everything else stays LF. */
export function withLineEndings(path: string, content: string): string {
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
    const mount = pack.mounts
      .filter((m) => !m.when || m.when(cfg))
      .sort((a, b) => b.from.length - a.from.length)
      .find((m) => inPack.startsWith(m.from));
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
  for (const f of designFiles(config)) add(f.path, f.content);
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
