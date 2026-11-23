/**
 * `scaffolder adopt <dir>`: add the `.ai/` operating system to a repository that already exists.
 *
 * The engine is pure; this file is the I/O around it: scan the folder into a snapshot, run detection, show what it found,
 * and (with --write) write the files. It only ever writes inside `.ai/` plus the managed block of the root AGENTS.md, and
 * it never overwrites a file of yours: a file that already exists is kept (and reported) unless --force is given.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ADOPT_DIR, mergeAgentsBlock, type AdoptResult, type RepoSnapshot } from "../src/engine";

/** Folders that hold dependencies, build output or caches, never the project's own code. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".next", ".nuxt", ".turbo", ".cache",
  "dist", "build", "target", "coverage", ".idea", ".gradle", ".terraform", ".svn", ".hg",
]);
const MAX_DEPTH = 6;
const MAX_FILES = 30_000;
const MAX_READ_BYTES = 512 * 1024;

/** Walk the repository into a snapshot. A virtual environment (a folder with pyvenv.cfg) is recorded but not entered. */
export function scanRepository(root: string): RepoSnapshot {
  const paths: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (paths.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    if (entries.includes("pyvenv.cfg")) {
      paths.push(relative(root, join(dir, "pyvenv.cfg")).split(sep).join("/"));
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join("/");
      if (rel === ".ai/evidence" || SKIP_DIRS.has(name)) continue;
      let info;
      try {
        info = lstatSync(full);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (depth < MAX_DEPTH) walk(full, depth + 1);
      } else if (info.isFile()) {
        paths.push(rel);
      }
    }
  };
  walk(root, 0);
  return {
    name: root.split(sep).filter(Boolean).pop() ?? "my-repo",
    paths,
    read(path) {
      try {
        const full = join(root, path);
        if (statSync(full).size > MAX_READ_BYTES) return undefined;
        return readFileSync(full, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}

export type Action = "create" | "unchanged" | "keep" | "overwrite" | "update" | "skip";

export interface PlannedFile {
  path: string;
  action: Action;
  executable: boolean;
  content: string;
  note?: string;
}

/** What writing would do to each file, decided against what is on disk now. */
export function planOverlay(root: string, result: AdoptResult, force: boolean): PlannedFile[] {
  const plan: PlannedFile[] = [];
  for (const file of result.files) {
    if (file.path.includes("..") || file.path.startsWith("/")) throw new Error(`refusing to write outside the repository: ${file.path}`);
    const full = join(root, file.path);
    let action: Action = "create";
    if (existsSync(full)) {
      const current = readFileSync(full, "utf8");
      action = current === file.content ? "unchanged" : force ? "overwrite" : "keep";
    }
    plan.push({ path: file.path, action, executable: file.executable, content: file.content });
  }
  if (result.agentsBlock) {
    const full = join(root, "AGENTS.md");
    const current = existsSync(full) ? readFileSync(full, "utf8") : undefined;
    const merged = mergeAgentsBlock(current, result.agentsBlock);
    if (merged.problem) {
      plan.push({ path: "AGENTS.md", action: "skip", executable: false, content: "", note: merged.problem });
    } else {
      const action: Action = current === undefined ? "create" : merged.content === current ? "unchanged" : "update";
      plan.push({ path: "AGENTS.md", action, executable: false, content: merged.content, note: action === "update" ? "only the scaffolder block inside it" : undefined });
    }
  }
  return plan;
}

export function writeOverlay(root: string, plan: PlannedFile[]): void {
  for (const item of plan) {
    if (item.action === "unchanged" || item.action === "keep" || item.action === "skip") continue;
    const full = join(root, item.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, item.content);
    if (item.executable) chmodSync(full, 0o755);
  }
}

function section(title: string, lines: string[]): string {
  return lines.length === 0 ? "" : `\n${title}\n${lines.map((l) => `  ${l}`).join("\n")}\n`;
}

/** The human-readable report: what was found, what would be (or was) written, what is left for you. */
export function renderReport(dir: string, result: AdoptResult, plan: PlannedFile[], written: boolean): string {
  const { detection: d, config } = result;
  const count = (a: Action) => plan.filter((p) => p.action === a).length;
  const out: string[] = [];
  out.push(`${written ? "Adopted" : "Dry run for"} ${dir}  (project "${config.project.name}")`);

  out.push(
    section(
      "Found",
      d.components.length > 0 ? d.components.map((c) => `${c.id.padEnd(14)} ${c.dir.padEnd(16)} ${c.summary}`) : ["no Node or Python component, no Makefile gate"],
    ),
  );
  const gates = JSON.parse(result.files.find((f) => f.path === `${ADOPT_DIR}/sdlc.json`)?.content ?? "{}") as { gates?: Array<{ id: string; stage: string; cmd: string; cwd: string }> };
  out.push(
    section(
      "Gates it will run (the repository's own commands)",
      (gates.gates ?? []).map((g) => `${g.stage.padEnd(9)} ${g.id.padEnd(18)} ${g.cmd}${g.cwd === "." ? "" : `   (in ${g.cwd})`}`),
    ),
  );
  out.push(section("Setup", d.setup.map((s) => `${s.id.padEnd(18)} ${s.cmd}${s.cwd === "." ? "" : `   (in ${s.cwd})`}`)));
  out.push(section("Guarded (changes allowed, always listed for review)", d.guardedPaths));
  out.push(section("Not covered (it will not pretend)", d.notCovered));
  out.push(section("Worth enabling by hand", d.suggestions));
  out.push(section("Settings", result.issues.filter((i) => i.level === "warning").map((i) => `warning ${i.path}: ${i.message}`)));

  const files = plan.map((p) => `${p.action.padEnd(9)} ${p.path}${p.note ? `   (${p.note})` : ""}`);
  out.push(section(`${written ? "Written" : "Would write"}: ${count("create")} new, ${count("update") + count("overwrite")} changed, ${count("unchanged")} already identical, ${count("keep")} of yours kept`, files.slice(0, 60)));
  if (files.length > 60) out.push(`  ... and ${files.length - 60} more\n`);
  const kept = plan.filter((p) => p.action === "keep");
  if (kept.length > 0) {
    out.push(`\n${kept.length} existing file(s) differ from what adopt would write and were left alone. Use --force to overwrite the generated ones.\n`);
  }
  for (const hint of result.hints) out.push(`hint: ${hint}\n`);

  if (written) {
    out.push(
      `\nNext, in ${dir}:\n` +
        `  ./${ADOPT_DIR}/sdlc doctor\n` +
        `  ./${ADOPT_DIR}/sdlc setup\n` +
        `  ./${ADOPT_DIR}/sdlc baseline     # records what passes today; commit .ai/ including .ai/baseline.json\n` +
        `  ./${ADOPT_DIR}/sdlc verify\n` +
        `(Windows PowerShell or cmd: .\\${ADOPT_DIR}\\sdlc.cmd doctor, then setup, baseline, verify)\n`,
    );
  } else {
    out.push("\nThis was a dry run: nothing was written. Review the above, then add --write.\n");
  }
  return out.filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
}

export function resolveTarget(dir: string): string {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`not a folder: ${dir}`);
  return root;
}
