#!/usr/bin/env node
// Renders README.md and docs/wiki/*.md to HTML at build time, so the web app can show the whole documentation
// without sending anyone to GitHub, and without the copy in the app ever drifting from the files in the repository.
//
//   src/docs.generated.ts       every page's HTML (used on the server only)
//   src/docsIndex.generated.ts  titles, headings and plain text (used by the sidebar and the search in the browser)
//
// The build FAILS on a link that goes nowhere (an unknown page or a missing heading), so a broken link cannot ship.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const wikiDir = join(repo, "docs", "wiki");

/** GitHub's heading-to-anchor rule, the same one the wiki's own tests use. */
function slugify(heading) {
  return heading
    .replace(/[`*]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decodeEntities = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const stripTags = (html) => decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// Which pages exist, in the order the wiki's sidebar lists them (README first).
const sidebar = readFileSync(join(wikiDir, "_Sidebar.md"), "utf8");
const nav = [...sidebar.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map((m) => ({ label: m[1], slug: m[2] }));
for (const f of readdirSync(wikiDir).filter((f) => f.endsWith(".md") && f !== "_Sidebar.md")) {
  const slug = f.replace(/\.md$/, "");
  if (!nav.some((n) => n.slug === slug)) nav.push({ label: slug.replace(/-/g, " "), slug });
}
const sources = [
  { slug: "README", label: "README: the whole picture", file: join(repo, "README.md"), kind: "readme" },
  ...nav.map((n) => ({ slug: n.slug, label: n.label, file: join(wikiDir, `${n.slug}.md`), kind: "wiki" })),
];
const slugs = new Set(sources.map((s) => s.slug));

/** Where a markdown link should go inside the app. Throws for anything that would lead nowhere. */
function resolveLink(href, from) {
  if (/^(https?:|mailto:)/.test(href)) return { href, external: true };
  if (href.startsWith("#")) return { href, page: from, hash: href.slice(1) };
  const [path, hash] = href.split("#");
  const name = path.replace(/^docs\/wiki\//, "").replace(/\.md$/, "");
  if (!slugs.has(name)) throw new Error(`${from}: the link "${href}" goes to a page that is not part of the documentation`);
  return { href: `/docs/${name}${hash ? `#${hash}` : ""}`, page: name, hash };
}

function render(source) {
  const headings = [];
  const links = [];
  const seen = new Set();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        const base = slugify(text);
        let id = base;
        for (let n = 1; seen.has(id); n++) id = `${base}-${n}`;
        seen.add(id);
        if (depth <= 3) headings.push({ id, text: stripTags(inner), level: depth });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const target = resolveLink(href, source.slug);
        if (target.page) links.push({ from: source.slug, page: target.page, hash: target.hash });
        const attrs = target.external ? ' target="_blank" rel="noopener noreferrer"' : "";
        return `<a href="${escapeHtml(target.href)}"${title ? ` title="${escapeHtml(title)}"` : ""}${attrs}>${this.parser.parseInline(tokens)}</a>`;
      },
      code({ text, lang }) {
        const language = (lang ?? "").split(/\s/)[0];
        return (
          `<div class="codeblock"><button type="button" class="copybtn" data-copy>Copy</button>` +
          `<pre tabindex="0"><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(text)}</code></pre></div>\n`
        );
      },
    },
  });
  let html = marked.parse(readFileSync(source.file, "utf8"));
  // tables scroll sideways on narrow screens instead of breaking the page
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  const title = headings.find((h) => h.level === 1)?.text ?? source.label;
  return { html, headings, links, title };
}

const pages = sources.map((s) => ({ ...s, ...render(s) }));

// Every internal link must land on a heading that exists.
const problems = [];
const idsOf = new Map(pages.map((p) => [p.slug, new Set(p.headings.map((h) => h.id))]));
for (const p of pages) {
  for (const l of p.links) {
    if (l.hash && !idsOf.get(l.page)?.has(l.hash)) problems.push(`${l.from}: the link to "${l.page}#${l.hash}" has no matching heading`);
  }
}
if (problems.length > 0) {
  console.error(`The documentation has links that go nowhere:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const banner = "// AUTO-GENERATED by scripts/bundle-docs.mjs from README.md and docs/wiki/. Do not edit.\n";
const out = (name, body) => writeFileSync(join(repo, "src", name), banner + body);
mkdirSync(join(repo, "src"), { recursive: true });

out(
  "docs.generated.ts",
  `export interface DocHeading {\n  id: string;\n  text: string;\n  level: number;\n}\n\n` +
    `export interface DocPage {\n  slug: string;\n  label: string;\n  title: string;\n  kind: "readme" | "wiki";\n  html: string;\n  headings: DocHeading[];\n}\n\n` +
    `export const DOC_PAGES: DocPage[] = ${JSON.stringify(
      pages.map(({ slug, label, title, kind, html, headings }) => ({ slug, label, title, kind, html, headings })),
      null,
      1,
    )};\n`,
);

out(
  "docsIndex.generated.ts",
  `import type { DocHeading } from "./docs.generated";\n\n` +
    `export interface DocIndexEntry {\n  slug: string;\n  label: string;\n  title: string;\n  kind: "readme" | "wiki";\n  headings: DocHeading[];\n  /** The page as plain text, for the search. */\n  text: string;\n}\n\n` +
    `export const DOC_INDEX: DocIndexEntry[] = ${JSON.stringify(
      pages.map(({ slug, label, title, kind, html, headings }) => ({
        slug,
        label,
        title,
        kind,
        headings,
        text: stripTags(html.replace(/<button[^>]*>.*?<\/button>/g, "")),
      })),
      null,
      1,
    )};\n`,
);

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(
  `rendered ${pages.length} pages (${pages.map((p) => p.slug).join(", ")}) -> ${relative(repo, join(repo, "src", "docs.generated.ts"))} (${kb(pages.reduce((n, p) => n + p.html.length, 0))} of HTML)`,
);
