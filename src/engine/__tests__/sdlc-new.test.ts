import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config";
import { generateProject } from "../generate";

/**
 * `sdlc new` copies the empty spec template and never reads a document. Handing it `requirements.pdf` used to create a
 * feature called "requirements-pdf" whose prd.md was all TODO(prd), which `implement` then refused. `new` now refuses a
 * document and points at `spec`, the command that reads it.
 */
function inGeneratedProject(run: (dir: string, sdlc: (...args: string[]) => ReturnType<typeof spawnSync>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "scaffolder-new-"));
  try {
    for (const f of generateProject(defaultConfig()).files) {
      const target = join(dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    run(dir, (...args) => spawnSync("python3", ["-I", join(dir, "scripts", "sdlc.py"), ...args], { cwd: dir, encoding: "utf8", timeout: 60_000 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const features = (dir: string): string[] => readdirSync(join(dir, ".ai", "specs")).filter((n) => n.startsWith("FEAT-"));

describe("sdlc new", () => {
  it("refuses a requirements document and points to `spec` instead of creating an empty spec", () => {
    inGeneratedProject((dir, sdlc) => {
      const before = features(dir);
      for (const doc of ["requirements.pdf", "Brief.DOCX", "notes.md", "spec.txt"]) {
        const run = sdlc("new", doc);
        if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") return; // no python3 here
        expect(run.status, String(run.stderr)).toBe(64);
        expect(String(run.stdout)).toContain(`./scripts/sdlc spec ${doc}`);
      }
      expect(features(dir)).toEqual(before);
    });
  });

  it("also refuses an existing file whatever its extension", () => {
    inGeneratedProject((dir, sdlc) => {
      writeFileSync(join(dir, "requirements"), "Users can log in.");
      const run = sdlc("new", join(dir, "requirements"));
      if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") return;
      expect(run.status).toBe(64);
    });
  });

  it("still creates a spec from a feature name", () => {
    inGeneratedProject((dir, sdlc) => {
      const run = sdlc("new", "user-login");
      if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") return;
      expect(run.status, String(run.stderr)).toBe(0);
      const created = features(dir).find((n) => n.endsWith("-user-login"));
      expect(created, "no FEAT-*-user-login folder").toBeDefined();
      expect(existsSync(join(dir, ".ai", "specs", created!, "prd.md"))).toBe(true);
    });
  });
});
