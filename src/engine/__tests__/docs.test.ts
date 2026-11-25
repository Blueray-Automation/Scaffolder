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
      [
        "Adopt-an-Existing-Project",
        "API-Integration",
        "Contributing-and-Releasing",
        "Design-and-the-UI",
        "Desktop-Apps",
        "Getting-Started",
        "Home",
        "Reference-Login-Implementation",
        "Setup-by-Operating-System",
        "Stacks-and-Options",
        "Status-and-Limits",
        "The-Verification-Loop",
        "Troubleshooting",
        "Tutorial-Add-a-Login-API",
        "_Sidebar",
      ].sort(),
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

  it("groups the sidebar, lists each page once, and puts Home first", () => {
    const sidebar = pages.get("_Sidebar")!;
    const links = [...sidebar.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
    expect(links[0]).toBe("Home");
    expect(new Set(links).size, "a page is listed twice").toBe(links.length);
    const groups = [...sidebar.matchAll(/^\*\*(.+)\*\*\s*$/gm)].map((m) => m[1]);
    expect(groups).toEqual(["Start", "Build", "Understand", "Help"]);
  });

  it("lets a reader reach every page from Home, so no page is a dead end", () => {
    const home = pages.get("Home")!;
    for (const name of pages.keys()) {
      if (name === "Home" || name === "_Sidebar") continue;
      expect(home, `Home does not point to ${name}`).toContain(`](${name})`);
    }
  });

  it("keeps the README a front door: short, pointing to a page for each topic", () => {
    const readme = readFileSync(join(WIKI_DIR, "..", "..", "README.md"), "utf8");
    expect(readme.split("\n").length, "the README grew past a front door: move the detail to a wiki page").toBeLessThanOrEqual(130);
    for (const name of pages.keys()) {
      // every topic is one click from the README; the tutorial's code listing is reached from the tutorial itself
      if (["Home", "_Sidebar", "Reference-Login-Implementation"].includes(name)) continue;
      expect(readme, `the README does not point to ${name}`).toContain(`docs/wiki/${name}.md`);
    }
  });

  it("covers the design layer where a reader looks for it", () => {
    const readme = readFileSync(join(WIKI_DIR, "..", "..", "README.md"), "utf8");
    expect(readme).toContain("Design is a contract too");
    expect(readme).toContain("./scripts/sdlc design check");
    expect(pages.get("Home")).toContain("](Design-and-the-UI)");
    expect(pages.get("Design-and-the-UI")).toContain("## In five minutes");
    expect(pages.get("Stacks-and-Options")).toContain("design.enforce");
    expect(pages.get("Status-and-Limits")).toContain("The Figma import has not been run against Figma");
  });

  it("covers the API integration layer where a reader looks for it", () => {
    const readme = readFileSync(join(WIKI_DIR, "..", "..", "README.md"), "utf8");
    expect(readme).toContain("API integration is a contract too");
    expect(readme).toContain("./scripts/sdlc spec requirements.pdf --api openapi.yaml");
    expect(pages.get("Home")).toContain("](API-Integration)");
    expect(pages.get("API-Integration")).toContain("## In five minutes");
    expect(pages.get("Stacks-and-Options")).toContain("api.enforce");
    expect(pages.get("Status-and-Limits")).toContain("No document from a real API");
    expect(pages.get("Troubleshooting")).toContain("prd.md has no 'API integration' section");
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

  it("only mentions ./.ai/sdlc commands (adopted projects) that exist, in both the POSIX and the Windows spelling", () => {
    const template = readFileSync(SDLC_TEMPLATE, "utf8");
    const real = new Set([...template.matchAll(/add_parser\("([a-z]+)"\)/g)].map((m) => m[1]!));
    expect(real.has("baseline")).toBe(true);
    let seen = 0;
    for (const [name, markdown] of pages) {
      for (const m of markdown.matchAll(/\.\/\.ai\/sdlc\s+([a-z]+)/g)) {
        seen++;
        expect(real.has(m[1]!), `${name}: "./.ai/sdlc ${m[1]}" is not a command`).toBe(true);
      }
      for (const m of markdown.matchAll(/\.ai\\sdlc\.cmd\s+([a-z]+)/g)) {
        expect(real.has(m[1]!), `${name}: ".ai\\sdlc.cmd ${m[1]}" is not a command`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(8);
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
