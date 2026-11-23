import { describe, expect, it } from "vitest";
import { defaultConfig, deepMerge, validateConfig } from "../config";
import { generateProject } from "../generate";
import { PRESETS, applyPreset, detectPreset, presetProblems } from "../presets";

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

describe("start-from presets", () => {
  it("offers the three API stacks plus Next.js, Nuxt, Flutter, native Android and native iOS", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["fullstack", "api", "api-lite", "nextjs", "nuxt", "flutter", "android", "ios"]);
  });

  it("the original three keep producing exactly what they did", () => {
    const old: Record<string, Record<string, unknown>> = {
      fullstack: {},
      api: { web: { enabled: false } },
      "api-lite": { web: { enabled: false }, database: { type: "none" } },
    };
    for (const [id, patch] of Object.entries(old)) {
      const now = generateProject(applyPreset(defaultConfig(), preset(id)));
      const before = generateProject(deepMerge(defaultConfig(), patch));
      expect(presetProblems(preset(id)), id).toEqual([]);
      expect(now.files.map((f) => [f.path, f.content]), id).toEqual(before.files.map((f) => [f.path, f.content]));
    }
  });

  it("a preset is available exactly when the generator can build it, and says why when it cannot", () => {
    for (const p of PRESETS) {
      const result = generateProject(applyPreset(defaultConfig(), p));
      const problems = presetProblems(p);
      if (problems.length === 0) {
        expect(result.files.length, `${p.id} is available but generates nothing`).toBeGreaterThan(0);
      } else {
        expect(result.files, `${p.id} is unavailable but generates files`).toEqual([]);
        expect(result.issues.filter((i) => i.level === "error").map((i) => i.message), p.id).toEqual(problems);
      }
    }
  });

  it("Next.js and Nuxt on their own generate; presets without a pack are blocked by the validator, never generated as stubs", () => {
    for (const [id, marker] of [["nextjs", "web/next.config.mjs"], ["nuxt", "web/nuxt.config.ts"]]) {
      expect(presetProblems(preset(id)), id).toEqual([]);
      const result = generateProject(applyPreset(defaultConfig(), preset(id)));
      expect(result.issues.filter((i) => i.level === "error"), id).toEqual([]);
      expect(result.files.some((f) => f.path === marker), id).toBe(true);
      expect(result.files.some((f) => f.path.startsWith("web/")), id).toBe(true);
      expect(result.files.some((f) => f.path.startsWith("backend/")), id).toBe(false);
    }

    for (const id of ["flutter", "android", "ios"]) {
      expect(presetProblems(preset(id)).length, id).toBeGreaterThan(0);
    }
  });

  it("applying a preset is detected as that preset, from any starting point", () => {
    const starts = [defaultConfig(), applyPreset(defaultConfig(), preset("ios")), applyPreset(defaultConfig(), preset("api-lite"))];
    for (const start of starts) {
      for (const p of PRESETS) expect(detectPreset(applyPreset(start, p))?.id, p.id).toBe(p.id);
    }
  });

  it("every preset is a different stack", () => {
    const keys = PRESETS.map((p) => JSON.stringify(applyPreset(defaultConfig(), p), ["backend", "web", "mobile", "database", "enabled", "framework", "type"]));
    expect(new Set(keys).size).toBe(PRESETS.length);
  });

  it("switching preset changes only the stack: project, ports, CI/CD and the agent are kept", () => {
    const mine = deepMerge(defaultConfig(), {
      project: { name: "my-app", owner: "acme" },
      backend: { port: 9100 },
      web: { port: 9200 },
      cd: { target: "ssh-compose" },
      sdlc: { agent: { preset: "codex" }, maxIterations: 9 },
    });
    const next = applyPreset(mine, preset("api-lite"));
    expect(next.web.enabled).toBe(false);
    expect(next.database.type).toBe("none");
    expect({ ...next, web: mine.web, database: mine.database }).toEqual(mine);
    expect(next.web.port).toBe(9200);

    const back = applyPreset(next, preset("fullstack"));
    expect(back).toEqual(mine);
  });

  it("switching to a database preset leaves a database version the engine supports", () => {
    const noDb = deepMerge(defaultConfig(), { database: { type: "none", version: "" } });
    const next = applyPreset(noDb, preset("api"));
    expect(next.database.type).toBe("postgres");
    expect(validateConfig(next).filter((i) => i.path === "database.version")).toEqual([]);
  });

  it("a hand-edited stack matches no preset", () => {
    expect(detectPreset(deepMerge(defaultConfig(), { database: { type: "none" } }))).toBeUndefined();
    expect(detectPreset(deepMerge(defaultConfig(), { web: { enabled: false }, mobile: { enabled: true, framework: "flutter" } }))).toBeUndefined();
  });
});
