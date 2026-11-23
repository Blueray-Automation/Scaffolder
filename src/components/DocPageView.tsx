import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { DocPage } from "@/docs.generated";
import { neighbours, sourceFile } from "@/lib/docs";
import { DocArticle } from "./DocArticle";

const href = (p: DocPage) => (p.slug === "Home" ? "/docs" : `/docs/${p.slug}`);

/** One documentation page: the article, a table of contents when the page has sections, and the way to the previous and next page. */
export function DocPageView({ page }: { page: DocPage }) {
  const { previous, next } = neighbours(page.slug);
  const sections = page.headings.filter((h) => h.level >= 2);
  return (
    <div className="gap-8 xl:grid xl:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="min-w-0">
        <DocArticle html={page.html} title={page.title} />
        <p className="mt-10 text-[11px] text-zinc-600">
          This page is <code className="font-mono">{sourceFile(page)}</code> in the repository, rendered here.
        </p>
        <nav aria-label="Previous and next page" className="mt-4 flex flex-wrap justify-between gap-3 border-t border-zinc-800 pt-4 text-sm">
          {previous ? (
            <Link href={href(previous)} className="inline-flex items-center gap-2 rounded-lg text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
              <ArrowLeft className="h-4 w-4" aria-hidden /> {previous.label}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={href(next)} className="inline-flex items-center gap-2 rounded-lg text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
              {next.label} <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </nav>
      </div>
      {sections.length > 2 && (
        <nav aria-label="On this page" className="hidden xl:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-auto text-xs">
            <p className="mb-2 font-medium text-zinc-400">On this page</p>
            <ul className="space-y-1.5 border-l border-zinc-800">
              {sections.map((h) => (
                <li key={h.id} className={h.level === 3 ? "pl-6" : "pl-3"}>
                  <a href={`#${h.id}`} className="block rounded text-zinc-500 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      )}
    </div>
  );
}
