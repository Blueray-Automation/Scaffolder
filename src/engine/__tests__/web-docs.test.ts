import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { AppHeader } from "@/components/AppHeader";
import { searchDocs } from "@/components/DocsSearch";
import { ExistingProject } from "@/components/ExistingProject";
import { DOC_PAGES } from "@/docs.generated";
import { DOC_INDEX } from "@/docsIndex.generated";
import { adoptProject } from "../adopt/generate";
import { snapshotFromFiles } from "../adopt/detect";
import { AGENT_PRESETS } from "../capabilities";
import { buildAdoptCommand, shellQuote } from "@/lib/adoptCommand";

/**
 * What the web app shows about the workflow: the README and the wiki rendered into /docs, and the interactive guide at /existing.
 * Nothing here needs a browser: the pages are rendered to HTML on the server, the way the build does.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNNER = readFileSync(join(REPO, "templates", "core", "scripts", "sdlc.py.tmpl"), "utf8");
const RUNNER_COMMANDS = new Set([...RUNNER.matchAll(/add_parser\("([a-z]+)"\)/g)].map((m) => m[1]!));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("the documentation inside the app", () => {
  const wikiFiles = readdirSync(join(REPO, "docs", "wiki")).filter((f) => f.endsWith(".md") && f !== "_Sidebar.md").map((f) => f.replace(/\.md$/, ""));

  it("has the README and every wiki page, README first, and the same pages in the search index", () => {
    expect(DOC_PAGES[0]?.slug).toBe("README");
    expect(DOC_PAGES.map((p) => p.slug).sort()).toEqual(["README", ...wikiFiles].sort());
    expect(DOC_INDEX.map((p) => p.slug)).toEqual(DOC_PAGES.map((p) => p.slug));
    for (const p of DOC_PAGES) {
      expect(p.title.length, p.slug).toBeGreaterThan(2);
      expect(p.html.length, p.slug).toBeGreaterThan(500);
    }
  });

  it("keeps the whole text of the repository's files, so nothing is left for GitHub", () => {
    const readme = readFileSync(join(REPO, "README.md"), "utf8");
    const page = DOC_PAGES.find((p) => p.slug === "README")!;
    // a few sentences from the middle and the end of the README must be in the rendered page
    for (const phrase of ["Adopt an existing project", "Publishing the CLI", "Limits (as of this version)", "Why \"facts\" and not just tests"]) {
      expect(readme).toContain(phrase);
      expect(text(page.html), phrase).toContain(phrase.replace(/\\"/g, '"'));
    }
    const adopt = DOC_PAGES.find((p) => p.slug === "Adopt-an-Existing-Project")!;
    expect(text(adopt.html)).toContain("Let an agent describe the repository");
  });

  it("links only to pages and headings that exist, and opens outside links safely", () => {
    const ids = new Map(DOC_PAGES.map((p) => [p.slug, new Set(p.headings.map((h) => h.id))]));
    let internal = 0;
    for (const p of DOC_PAGES) {
      for (const m of p.html.matchAll(/<a href="([^"]+)"([^>]*)>/g)) {
        const href = m[1]!;
        if (/^https?:/.test(href)) {
          expect(m[2], `${p.slug}: ${href}`).toContain('rel="noopener noreferrer"');
        } else if (href.startsWith("#")) {
          expect(p.html, `${p.slug}: ${href}`).toContain(`id="${href.slice(1)}"`);
        } else {
          internal++;
          const [path, hash] = href.split("#");
          const slug = path!.replace(/^\/docs\//, "");
          expect(ids.has(slug), `${p.slug}: ${href}`).toBe(true);
          if (hash) expect(ids.get(slug)!.has(hash), `${p.slug}: ${href}`).toBe(true);
        }
      }
    }
    expect(internal).toBeGreaterThan(20);
  });

  it("is safe to inject: no scripts, no inline handlers, and code is escaped", () => {
    for (const p of DOC_PAGES) {
      expect(p.html, p.slug).not.toMatch(/<script|<iframe|\son[a-z]+=|javascript:/i);
    }
    const getting = DOC_PAGES.find((p) => p.slug === "Getting-Started")!;
    expect(getting.html).toContain('<div class="codeblock"><button type="button" class="copybtn" data-copy>Copy</button>');
  });

  it("gives every code block a Copy button, every heading a unique id, and wraps tables so they scroll", () => {
    for (const p of DOC_PAGES) {
      expect((p.html.match(/<pre/g) ?? []).length, p.slug).toBe((p.html.match(/data-copy/g) ?? []).length);
      const ids = [...p.html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]!);
      expect(new Set(ids).size, `${p.slug} has duplicate heading ids`).toBe(ids.length);
      expect((p.html.match(/<table>/g) ?? []).length, p.slug).toBe((p.html.match(/class="table-wrap"/g) ?? []).length);
    }
  });

  it("only shows runner commands that exist (README included, which the wiki's own test does not cover)", () => {
    let seen = 0;
    for (const p of DOC_PAGES) {
      // only what the page marks as code: prose such as "./scripts/sdlc stays the judge" is not a command
      const code = [...p.html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)].map((m) => text(m[1]!)).join("\n");
      for (const m of code.matchAll(/\.\/(?:scripts|\.ai)\/sdlc[ \t]+([a-z]+)/g)) {
        seen++;
        expect(RUNNER_COMMANDS.has(m[1]!), `${p.slug}: "sdlc ${m[1]}" is not a command`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(40);
  });
});

describe("searching the docs", () => {
  it("finds sections by heading and pages by text, and says nothing for noise", () => {
    const hits = searchDocs("baseline");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(8);
    expect(hits.some((h) => h.slug === "Adopt-an-Existing-Project")).toBe(true);
    const heading = searchDocs("Troubleshooting").find((h) => h.heading);
    expect(heading?.heading?.id).toBeTruthy();
    expect(searchDocs("zzqqxx-not-a-word")).toEqual([]);
    expect(searchDocs("a")).toEqual([]);
    expect(searchDocs("  ")).toEqual([]);
  });

  it("shows the match inside its surrounding words", () => {
    const hit = searchDocs("trusted publishing").find((h) => !h.heading);
    expect(hit?.match.toLowerCase()).toBe("trusted publishing");
    expect(`${hit?.before}${hit?.match}${hit?.after}`.length).toBeGreaterThan(30);
  });
});

describe("the header", () => {
  it("links the three places, marks only the current one, and every target is a real page", () => {
    const html = renderToStaticMarkup(createElement(AppHeader, { active: "existing" }));
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/", "/", "/existing", "/docs"]);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Existing project</);
    for (const route of ["page.tsx", "existing/page.tsx", "docs/page.tsx", "docs/[slug]/page.tsx"]) {
      expect(readFileSync(join(REPO, "src", "app", route), "utf8").length, route).toBeGreaterThan(50);
    }
  });
});

describe("the adopt command builder", () => {
  const base = { dir: "./my-repo", write: false, force: false, leaveAgentsMd: false, agentPreset: "claude" };

  it("builds the plain dry run, then adds each choice", () => {
    expect(buildAdoptCommand(base)).toBe("npx ai-scaffolder adopt ./my-repo");
    expect(buildAdoptCommand({ ...base, write: true })).toBe("npx ai-scaffolder adopt ./my-repo --write");
    expect(buildAdoptCommand({ ...base, write: true, force: true })).toBe("npx ai-scaffolder adopt ./my-repo --write --force");
    expect(buildAdoptCommand({ ...base, leaveAgentsMd: true })).toBe("npx ai-scaffolder adopt ./my-repo --set rootFile=none");
    expect(buildAdoptCommand({ ...base, agentPreset: "codex" })).toBe("npx ai-scaffolder adopt ./my-repo --set sdlc.agent.preset=codex");
    expect(buildAdoptCommand({ ...base, dir: "  " })).toBe("npx ai-scaffolder adopt .");
  });

  it("quotes a folder so that spaces and shell characters cannot change the command", () => {
    expect(shellQuote("./my repo")).toBe("'./my repo'");
    expect(shellQuote("a;rm -rf ~")).toBe("'a;rm -rf ~'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
    expect(shellQuote("../repos/shop_1-2")).toBe("../repos/shop_1-2");
    // the home folder is expanded by the shell, so ~/ stays outside the quotes
    expect(shellQuote("~/my projects/shop")).toBe("~/'my projects/shop'");
    expect(shellQuote("~/shop")).toBe("~/shop");
    expect(shellQuote("~/")).toBe("~/");
    expect(shellQuote("~/a;b")).toBe("~/'a;b'");
    expect(buildAdoptCommand({ ...base, dir: "./my repo; touch pwned" })).toBe("npx ai-scaffolder adopt './my repo; touch pwned'");
  });

  it("never offers an agent the engine rejects, and the command line accepts what it prints", () => {
    const sample = snapshotFromFiles({ "package.json": JSON.stringify({ name: "x", scripts: { test: "jest" } }) }, "x");
    const offered = AGENT_PRESETS.filter((p) => p.id !== "custom");
    expect(offered.length).toBeGreaterThan(5);
    for (const p of offered) {
      const r = adoptProject(sample, { sdlc: { agent: { preset: p.id } } });
      expect(r.issues.filter((i) => i.level === "error"), p.id).toEqual([]);
    }
    // the real CLI, with the exact flags the page prints
    const dir = mkdtempSync(join(tmpdir(), "web-docs-"));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: "jest" } }));
    const command = buildAdoptCommand({ ...base, dir, write: true, leaveAgentsMd: true, agentPreset: "codex" });
    const args = command.split(" ").slice(3).map((a) => a.replace(/^'|'$/g, ""));
    const run = spawnSync("npx", ["tsx", join(REPO, "cli", "index.ts"), "adopt", ...args], { encoding: "utf8", timeout: 60_000 });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, ".ai", "sdlc.json"), "utf8")).agent.preset).toBe("codex");
  });
});

describe("the existing-project guide", () => {
  const html = renderToString(createElement(ExistingProject));
  const plain = text(html);

  it("shows the default command and the whole workflow, from a dry run to a verified feature", () => {
    expect(plain).toContain("npx ai-scaffolder adopt ./my-repo");
    expect(plain).toContain("npx ai-scaffolder adopt ./my-repo --write");
    for (const step of ["See what it would do", "Write it", "Record the starting line", "Let an agent describe the repository", "Build a feature, proven"]) {
      expect(plain, step).toContain(step);
    }
    for (const word of ["baseline", "onboard", "implement", "verify", "doctor", "setup"]) expect(plain, word).toContain(word);
  });

  it("every ./.ai/sdlc command it prints is a real runner command", () => {
    let seen = 0;
    for (const m of plain.matchAll(/\.\/\.ai\/sdlc\s+([a-z]+)/g)) {
      seen++;
      expect(RUNNER_COMMANDS.has(m[1]!), `"sdlc ${m[1]}" is not a command`).toBe(true);
    }
    expect(seen).toBeGreaterThanOrEqual(8);
  });

  it("explains the baseline rules and shows the sample repository's real output, produced by the engine", () => {
    expect(plain).toContain("nothing that passed yesterday fails today");
    for (const row of ["Known warning", "FAIL: a regression", "Now passing"]) expect(plain, row).toContain(row);
    for (const gate of ["node.lint", "node.types", "node.test", "node.build", "api.ruff", "api.pytest", "repo.secrets"]) expect(plain, gate).toContain(gate);
    expect(plain).toContain("package.json scripts.lint");
    expect(plain).toContain("Existing CI");
    expect(plain).toMatch(/\d+\s+files,\s+all inside/);
    expect(html).toContain("README.md"); // the explorer opens on .ai/README.md
  });

  it("links to the full guide and back to the generator", () => {
    expect(html).toContain('href="/docs/Adopt-an-Existing-Project"');
    expect(html).toContain('href="/"');
  });
});
