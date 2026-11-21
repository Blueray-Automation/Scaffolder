import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WIKI_DIR = fileURLToPath(new URL("../../../docs/wiki", import.meta.url));
const SDLC_TEMPLATE = fileURLToPath(new URL("../../../templates/core/scripts/sdlc.py.tmpl", import.meta.url));

const pages = new Map(
  readdirSync(WIKI_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f.replace(/\.md$/, ""), readFileSync(join(WIKI_DIR, f), "utf8")]),
);

/** GitHub's heading-to-anchor rule (good enough for our headings). */
function slug(heading: string): string {
  return heading
    .replace(/[`*]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Headings outside fenced code blocks (a `# comment` in a bash block is not a heading). */
function anchors(markdown: string): Set<string> {
  const found = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    const m = !inFence && line.match(/^#{1,6}\s+(.*)$/);
    if (m) found.add(slug(m[1]!));
  }
  return found;
}

function outsideFences(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .filter((line) => {
      if (line.startsWith("```")) inFence = !inFence;
      return !inFence && !line.startsWith("```");
    })
    .join("\n");
}

describe("wiki pages (docs/wiki)", () => {
  it("has the expected pages", () => {
    expect([...pages.keys()].sort()).toEqual(
      ["Desktop-Apps", "Getting-Started", "Home", "Reference-Login-Implementation", "Setup-by-Operating-System", "The-Verification-Loop", "Troubleshooting", "Tutorial-Add-a-Login-API", "_Sidebar"].sort(),
    );
  });

  it.each([...pages.entries()])("%s: every internal link and #anchor resolves", (name, markdown) => {
    const links = [...outsideFences(markdown).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
    for (const link of links) {
      if (/^(https?:|mailto:)/.test(link)) continue;
      const [target, anchor] = link.split("#");
      const page = target === "" ? name : target!;
      expect(pages.has(page), `${name}: link to missing page "${link}"`).toBe(true);
      if (anchor) expect(anchors(pages.get(page)!).has(anchor), `${name}: "${link}" has no matching heading`).toBe(true);
    }
  });

  it("links every page from the sidebar", () => {
    const sidebar = pages.get("_Sidebar")!;
    for (const name of pages.keys()) {
      if (name === "_Sidebar") continue;
      expect(sidebar, `sidebar is missing ${name}`).toContain(`](${name})`);
    }
  });

  it("only mentions ./scripts/sdlc commands that exist", () => {
    const template = readFileSync(SDLC_TEMPLATE, "utf8");
    const real = new Set([...template.matchAll(/add_parser\("([a-z]+)"\)/g)].map((m) => m[1]!));
    expect(real.size).toBeGreaterThan(8);
    for (const [name, markdown] of pages) {
      for (const m of markdown.matchAll(/\.\/scripts\/sdlc\s+([a-z]+)/g)) {
        expect(real.has(m[1]!), `${name}: "./scripts/sdlc ${m[1]}" is not a command`).toBe(true);
      }
    }
  });

  it("only mentions Windows `scripts\\sdlc.cmd` commands that exist", () => {
    const template = readFileSync(SDLC_TEMPLATE, "utf8");
    const real = new Set([...template.matchAll(/add_parser\("([a-z]+)"\)/g)].map((m) => m[1]!));
    let seen = 0;
    for (const [name, markdown] of pages) {
      for (const m of markdown.matchAll(/scripts\\sdlc\.cmd\s+([a-z]+)/g)) {
        seen++;
        expect(real.has(m[1]!), `${name}: "scripts\\sdlc.cmd ${m[1]}" is not a command`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it("explains setup for macOS, Ubuntu, native Windows and WSL2, and every page says what to type on Windows", () => {
    const setup = pages.get("Setup-by-Operating-System")!;
    for (const heading of ["## macOS", "## Ubuntu", "## Windows (native)", "## Windows with WSL2"]) expect(setup).toContain(heading);
    for (const id of ["Git.Git", "Python.Python.3.12", "OpenJS.NodeJS.LTS"]) expect(setup).toContain(`winget install -e --id ${id}`);
    expect(setup).toContain("python3-venv");
    expect(pages.get("Getting-Started")).toContain(".\\scripts\\sdlc.cmd");
    expect(pages.get("Troubleshooting")).toContain("## Windows");
    expect(pages.get("The-Verification-Loop")).toContain("scripts/sdlc.cmd");
  });

  it("documents the login tutorial's verified numbers consistently", () => {
    expect(pages.get("Reference-Login-Implementation")).toContain("all 29 checks");
    expect(pages.get("Tutorial-Add-a-Login-API")).toContain("VERIFIED  29 passed, 0 failed");
  });

  it("explains the Python version problem users actually hit", () => {
    const troubleshooting = pages.get("Troubleshooting")!;
    expect(troubleshooting).toContain("requires a different Python");
    expect(troubleshooting).toContain("SDLC_PYTHON");
    expect(troubleshooting).toContain("brew install python@3.12");
  });
});
