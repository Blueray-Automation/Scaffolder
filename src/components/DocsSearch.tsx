"use client";

import React, { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { DOC_INDEX } from "@/docsIndex.generated";

interface Hit {
  slug: string;
  label: string;
  /** The section the match is in, when it is in a heading. */
  heading?: { id: string; text: string };
  before: string;
  match: string;
  after: string;
}

const MAX_HITS = 8;

/** Plain substring search over the text of every page: headings first, then the body. No index to build, nothing to keep in step. */
export function searchDocs(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const headingHits: Hit[] = [];
  const bodyHits: Hit[] = [];
  for (const page of DOC_INDEX) {
    const heading = page.headings.find((h) => h.text.toLowerCase().includes(q));
    if (heading) headingHits.push({ slug: page.slug, label: page.label, heading, before: "", match: heading.text, after: "" });
    const at = page.text.toLowerCase().indexOf(q);
    if (at >= 0 && !heading) {
      const start = Math.max(0, at - 50);
      const end = Math.min(page.text.length, at + q.length + 70);
      bodyHits.push({
        slug: page.slug,
        label: page.label,
        before: `${start > 0 ? "…" : ""}${page.text.slice(start, at)}`,
        match: page.text.slice(at, at + q.length),
        after: `${page.text.slice(at + q.length, end)}${end < page.text.length ? "…" : ""}`,
      });
    }
  }
  return [...headingHits, ...bodyHits].slice(0, MAX_HITS);
}

export function DocsSearch() {
  const [query, setQuery] = useState("");
  const id = useId();
  const hits = useMemo(() => searchDocs(query), [query]);
  const active = query.trim().length >= 2;
  return (
    <div role="search">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-zinc-400">
        Search the docs
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" aria-hidden />
        <input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="baseline, onboard, Windows…"
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        />
      </div>
      <div aria-live="polite" className="mt-2">
        {active && hits.length === 0 && <p className="text-xs text-zinc-500">No page mentions “{query.trim()}”.</p>}
        {hits.length > 0 && (
          <ul className="space-y-1.5" aria-label="Search results">
            {hits.map((h) => (
              <li key={`${h.slug}-${h.heading?.id ?? "text"}`}>
                <Link
                  href={`/docs/${h.slug}${h.heading ? `#${h.heading.id}` : ""}`}
                  onClick={() => setQuery("")}
                  className="block rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-xs hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                >
                  <span className="block font-medium text-zinc-200">
                    {h.label}
                    {h.heading && <span className="font-normal text-zinc-400"> › {h.heading.text}</span>}
                  </span>
                  {!h.heading && (
                    <span className="mt-0.5 block text-zinc-500">
                      {h.before}
                      <mark className="rounded bg-indigo-500/30 px-0.5 text-zinc-100">{h.match}</mark>
                      {h.after}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
