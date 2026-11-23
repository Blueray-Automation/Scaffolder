import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { planOverlay, scanRepository, writeOverlay } from "../../../cli/adopt";
import { adoptProject } from "../adopt/generate";

/** Shared by the tests that drive the generated runner in real, throwaway git repositories. */

const dirs: string[] = [];

/** Call from `afterAll`. */
export function cleanup(): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const ENV = { ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" };

export function run(cwd: string, cmd: string, args: string[], input?: string) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8", env: ENV, timeout: 120_000, input });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export const git = (cwd: string, ...args: string[]) =>
  run(cwd, "git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args]);

export function write(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

/** A git repository with these files, committed. */
export function repo(files: Record<string, string>): string {
  const dir = scratch("adopt-run-");
  git(dir, "init", "-q", ".");
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "before adoption");
  return dir;
}

export function adopt(dir: string, config?: unknown) {
  const result = adoptProject(scanRepository(dir), config);
  expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
  writeOverlay(dir, planOverlay(dir, result, false));
  return result;
}

export const sdlc = (dir: string, ...args: string[]) => run(dir, join(dir, ".ai", "sdlc"), args);

export function commit(dir: string, message = "adopt"): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", message);
}

/**
 * A scripted "agent": a node program that reads the prompt on stdin, keeps it (prompt-1.md, prompt-2.md, ...) and writes the files of
 * step N (the last step repeats). A file named QUESTIONS is written to the questions path the prompt names. Lives outside the repository.
 */
export function scriptedAgent(steps: Array<Record<string, string>>): { command: string; prompt: (n: number) => string; calls: () => number } {
  const dir = scratch("adopt-agent-");
  writeFileSync(
    join(dir, "agent.js"),
    `const fs = require("fs"), path = require("path");
const here = __dirname;
const steps = ${JSON.stringify(steps)};
const prompt = fs.readFileSync(0, "utf8");
const n = fs.existsSync(path.join(here, "count")) ? Number(fs.readFileSync(path.join(here, "count"), "utf8")) + 1 : 1;
fs.writeFileSync(path.join(here, "count"), String(n));
fs.writeFileSync(path.join(here, "prompt-" + n + ".md"), prompt);
const step = steps[Math.min(n, steps.length) - 1];
for (const [file, content] of Object.entries(step)) {
  let target = file;
  if (file === "QUESTIONS") {
    const m = prompt.match(/explanation to \`([^\`]+)\`/);
    target = m ? m[1] : "QUESTIONS.md";
  }
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, content);
}
`,
  );
  return {
    command: `node ${join(dir, "agent.js")}`,
    prompt: (n) => (run(dir, "cat", [join(dir, `prompt-${n}.md`)]).out),
    calls: () => Number(run(dir, "cat", [join(dir, "count")]).out || 0),
  };
}
