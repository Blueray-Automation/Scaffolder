#!/usr/bin/env -S npx tsx
/**
 * scaffolder CLI: the same engine as the web UI, for automation and CI.
 *
 *   scaffolder init      [--out scaffolder.config.yaml]
 *   scaffolder validate  --config <file> [--set key=value ...]
 *   scaffolder generate  --config <file> --out <dir> [--set key=value ...] [--force] [--zip <file>]
 *   scaffolder adopt     <dir> [--config <file>] [--set key=value ...] [--write] [--force]
 *   scaffolder list
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import {
  adoptProject,
  CAPABILITIES,
  configToYaml,
  defaultConfig,
  deepMerge,
  generateProject,
  renderTree,
  toZip,
  type Issue,
} from "../src/engine";
import { planOverlay, renderReport, resolveTarget, scanRepository, writeOverlay } from "./adopt";

const USAGE = `scaffolder: generate AI-ready projects (PRD -> Code -> Test -> Deploy), or adopt an existing one

  scaffolder init      [--out scaffolder.config.yaml]
  scaffolder validate  --config <file> [--set key=value ...]
  scaffolder generate  --config <file> --out <dir> [--set key=value ...] [--force] [--zip <file>]
  scaffolder adopt     <dir> [--config <file>] [--set key=value ...] [--write] [--force]
  scaffolder list      show what can be generated today

--set overrides any config path, e.g.  --set sdlc.maxIterations=8 --set web.enabled=false

adopt adds the .ai/ folder (and a marked block in AGENTS.md) to a repository that already exists. It only shows what it found
until you add --write, and it never overwrites a file of yours (--force overwrites the files it generated). Its optional
--config file can drop or add gates, declare how to run the app, and set the agent, e.g.  --set rootFile=none
`;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

/** `a.b.c=value` -> nested object (value parsed as YAML so numbers, booleans and lists work). */
function applySet(base: unknown, assignments: string[]): unknown {
  let result = base;
  for (const assignment of assignments) {
    const eq = assignment.indexOf("=");
    if (eq < 1) fail(`--set expects key=value, got "${assignment}"`);
    const path = assignment.slice(0, eq).split(".");
    const value: unknown = parse(assignment.slice(eq + 1));
    const patch = path.reduceRight<unknown>((acc, key) => ({ [key]: acc }), value);
    result = deepMerge(result, patch);
  }
  return result;
}

function loadConfig(file: string | undefined, sets: string[]): unknown {
  let raw: unknown = {};
  if (file) {
    if (!existsSync(file)) fail(`config file not found: ${file}`);
    raw = parse(readFileSync(file, "utf8")) ?? {};
  }
  return applySet(raw, sets);
}

function printIssues(issues: Issue[]): void {
  for (const issue of issues) {
    const tag = issue.level === "error" ? "error  " : "warning";
    console.error(`  ${tag} ${issue.path}: ${issue.message}`);
  }
}

function isNonEmptyDir(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).length > 0;
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      config: { type: "string", short: "c" },
      out: { type: "string", short: "o" },
      set: { type: "string", multiple: true },
      force: { type: "boolean", short: "f", default: false },
      write: { type: "boolean", default: false },
      zip: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (!command || command === "help" || values.help) {
    console.log(USAGE);
    return;
  }
  if (command !== "adopt" && positionals.length > 0) fail(`unexpected argument "${positionals[0]}" for "${command}"\n\n${USAGE}`, 64);

  switch (command) {
    case "adopt": {
      const [dir, ...extra] = positionals;
      if (!dir || extra.length > 0) fail(`adopt needs exactly one folder: scaffolder adopt <dir> [--write]`, 64);
      let root: string;
      try {
        root = resolveTarget(dir);
      } catch (e) {
        return fail((e as Error).message);
      }
      const result = adoptProject(scanRepository(root), loadConfig(values.config, values.set ?? []));
      if (result.issues.some((i) => i.level === "error")) {
        console.error("Invalid adopt settings:");
        printIssues(result.issues);
        process.exit(1);
      }
      if (!existsSync(join(root, ".git"))) {
        result.hints.push("This folder is not a git repository. Run `git init` and commit first: the loop starts agents from a clean tree so you can review exactly what they change.");
      }
      const plan = planOverlay(root, result, values.force);
      if (values.write) writeOverlay(root, plan);
      console.log(renderReport(dir, result, plan, values.write));
      if (plan.some((p) => p.action === "skip")) process.exit(1);
      return;
    }

    case "init": {
      const out = values.out ?? "scaffolder.config.yaml";
      if (existsSync(out) && !values.force) fail(`${out} already exists (use --force to overwrite)`);
      writeFileSync(out, configToYaml(defaultConfig()));
      console.log(`wrote ${out}. Edit it, then: scaffolder generate --config ${out} --out ./my-project`);
      return;
    }

    case "list": {
      const names = (list: readonly { id: string; available: boolean }[]) =>
        list.map((o) => (o.available ? o.id : `${o.id} (planned)`)).join(", ");
      console.log(`backend languages : ${names(CAPABILITIES.backend.languages)}`);
      for (const lang of CAPABILITIES.backend.languages) {
        console.log(`  ${lang.id} frameworks : ${names(lang.frameworks)}`);
      }
      console.log(`web frameworks    : ${names(CAPABILITIES.web.frameworks)}`);
      console.log(`mobile            : ${names(CAPABILITIES.mobile.frameworks)}`);
      console.log(`databases         : ${names(CAPABILITIES.database)}`);
      console.log(`cache / auth      : ${names(CAPABILITIES.cache)} / ${names(CAPABILITIES.auth)}`);
      console.log(`ci / registry     : ${names(CAPABILITIES.ci)} / ${names(CAPABILITIES.registry)}`);
      console.log(`deploy targets    : ${names(CAPABILITIES.deployTarget)}`);
      console.log(`fact runtimes     : ${names(CAPABILITIES.runtime)}`);
      return;
    }

    case "validate":
    case "generate": {
      const input = loadConfig(values.config, values.set ?? []);
      const { config, issues, files } = generateProject(input);
      if (issues.some((i) => i.level === "error")) {
        console.error("Invalid configuration:");
        printIssues(issues);
        process.exit(1);
      }
      if (issues.length > 0) printIssues(issues);
      if (command === "validate") {
        console.log(`config is valid (${files.length} files would be generated)`);
        return;
      }

      const out = values.out;
      if (!out && !values.zip) fail("generate needs --out <dir> and/or --zip <file>");
      if (out) {
        const target = resolve(out);
        if (isNonEmptyDir(target) && !values.force) {
          fail(`${out} is not empty (use --force to write into it; existing files with the same path are overwritten)`);
        }
        for (const file of files) {
          const full = join(target, file.path);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, file.content);
          if (file.executable) chmodSync(full, 0o755);
        }
        console.log(`generated ${files.length} files in ${out}\n`);
        console.log(renderTree(files.map((f) => f.path), config.project.name).split("\n").slice(0, 40).join("\n"));
        console.log(
          `\nnext:\n  cd ${out}\n  ./scripts/sdlc doctor && ./scripts/sdlc setup && ./scripts/sdlc verify\n` +
            `  (Windows PowerShell/cmd: .\\scripts\\sdlc.cmd doctor, then setup, then verify)`,
        );
      }
      if (values.zip) {
        writeFileSync(values.zip, toZip(files, config.project.name));
        console.log(`wrote ${values.zip}`);
      }
      return;
    }

    default:
      console.error(`unknown command "${command}"\n`);
      console.error(USAGE);
      process.exit(64);
  }
}

main();
