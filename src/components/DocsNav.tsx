"use client";

import React, { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ChevronDown } from "lucide-react";
import { DOC_INDEX } from "@/docsIndex.generated";
import { cx } from "@/lib/utils";
import { DocsSearch } from "./DocsSearch";

/** The pages in reading order, grouped the way the wiki's sidebar groups them (a group's name is empty for the pages above the first group). */
const GROUPS = DOC_INDEX.reduce<{ name: string; pages: typeof DOC_INDEX }[]>((groups, page) => {
  const last = groups[groups.length - 1];
  if (last && last.name === page.group) last.pages.push(page);
  else groups.push({ name: page.group, pages: [page] });
  return groups;
}, []);

/** The documentation's sidebar: search, then every page in reading order under its group's name. A folded list on narrow screens. */
export function DocsNav() {
  const pathname = usePathname();
  const current = pathname === "/docs" ? "Home" : decodeURIComponent(pathname.replace(/^\/docs\//, "")).replace(/\/$/, "");
  // on a phone the list would fill the screen before the page itself, so it folds; on a wide screen it is always open
  const [open, setOpen] = useState(false);
  const listId = useId();
  const currentLabel = DOC_INDEX.find((p) => p.slug === current)?.label ?? "Pages";
  return (
    <div className="space-y-4">
      <DocsSearch />
      <nav aria-label="Documentation pages">
        <p className="mb-2 hidden items-center gap-1.5 text-xs font-medium text-zinc-400 lg:flex">
          <BookOpen className="h-3.5 w-3.5" aria-hidden /> Pages
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left text-sm text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 lg:hidden"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-indigo-400" aria-hidden />
            <span className="truncate">{currentLabel}</span>
          </span>
          <ChevronDown className={cx("h-4 w-4 shrink-0 text-zinc-400 transition-transform", open && "rotate-180")} aria-hidden />
          <span className="sr-only">{open ? "Hide the list of pages" : "Show the list of pages"}</span>
        </button>
        <div id={listId} className={cx("space-y-3", open ? "mt-2 block" : "hidden", "lg:mt-0 lg:block")}>
          {GROUPS.map((group) => (
            <div key={group.name}>
              {group.name && <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{group.name}</p>}
              <ul className="space-y-0.5">
                {group.pages.map((page) => (
                  <li key={page.slug}>
                    <Link
                      href={page.slug === "Home" ? "/docs" : `/docs/${page.slug}`}
                      aria-current={page.slug === current ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cx(
                        "block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
                        page.slug === current ? "bg-indigo-600/20 font-medium text-zinc-50" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
                      )}
                    >
                      {page.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
