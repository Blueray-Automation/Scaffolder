"use client";

import React, { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, FileText, Folder, Search } from "lucide-react";
import type { GeneratedFile } from "@/engine";
import { cx } from "@/lib/utils";
import { Badge, Button } from "./ui";

interface Row {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
}

/** Flatten paths into a sorted tree (directories first), skipping children of closed directories. */
function buildRows(paths: string[], closed: Set<string>, filter: string): Row[] {
  const needle = filter.trim().toLowerCase();
  const visible = needle ? paths.filter((p) => p.toLowerCase().includes(needle)) : paths;

  interface Node {
    children: Map<string, Node>;
    isFile: boolean;
  }
  const root: Node = { children: new Map(), isFile: false };
  for (const path of visible) {
    let node = root;
    for (const part of path.split("/")) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map(), isFile: false });
      node = node.children.get(part)!;
    }
    node.isFile = true;
  }

  const rows: Row[] = [];
  const walk = (node: Node, prefix: string, depth: number) => {
    const entries = [...node.children.entries()].sort(([an, a], [bn, b]) => {
      const ad = a.children.size > 0;
      const bd = b.children.size > 0;
      return ad === bd ? an.localeCompare(bn) : ad ? -1 : 1;
    });
    for (const [name, child] of entries) {
      const path = prefix ? `${prefix}/${name}` : name;
      const isDir = child.children.size > 0;
      rows.push({ path, name, depth, isDir });
      if (isDir && (needle || !closed.has(path))) walk(child, path, depth + 1);
    }
  };
  walk(root, "", 0);
  return rows;
}

export function FileExplorer({ files }: { files: GeneratedFile[] }) {
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const index = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const [chosen, setSelected] = useState("README.md");
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // If the chosen file disappears after a config change, show something that exists instead.
  const selected = index.has(chosen) ? chosen : index.has("README.md") ? "README.md" : (paths[0] ?? "");

  const rows = useMemo(() => buildRows(paths, closed, filter), [paths, closed, filter]);
  const file = index.get(selected);

  const toggle = (path: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const copy = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable (insecure context); the text is still selectable */
    }
  };

  return (
    <div className="grid min-h-[34rem] grid-cols-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 md:grid-cols-[17rem_1fr]">
      <div className="flex max-h-[40rem] flex-col border-b border-zinc-800 md:border-b-0 md:border-r">
        <div className="relative border-b border-zinc-800 p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input
            type="search"
            aria-label="Filter files"
            placeholder={`Filter ${files.length} files`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <ul role="tree" aria-label="Generated files" className="flex-1 overflow-auto p-1.5 text-xs">
          {rows.map((row) => {
            const open = !closed.has(row.path);
            return (
              <li key={row.path} role="treeitem" aria-selected={!row.isDir && row.path === selected} aria-expanded={row.isDir ? open : undefined}>
                <button
                  type="button"
                  onClick={() => (row.isDir ? toggle(row.path) : setSelected(row.path))}
                  style={{ paddingLeft: `${row.depth * 12 + 6}px` }}
                  className={cx(
                    "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono hover:bg-zinc-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
                    !row.isDir && row.path === selected ? "bg-indigo-500/15 text-indigo-200" : "text-zinc-300",
                  )}
                >
                  {row.isDir ? (
                    <>
                      {open || filter ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
                      <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/80" aria-hidden />
                    </>
                  ) : (
                    <FileText className="ml-4 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                  )}
                  <span className="truncate">{row.name}</span>
                </button>
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-2 py-3 text-zinc-500">No files match “{filter}”.</li>}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col">
        {file ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-xs text-zinc-300">{file.path}</span>
                {file.executable && <Badge tone="info">executable</Badge>}
              </div>
              <Button variant="ghost" onClick={copy} aria-label={`Copy ${file.path}`}>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre
              tabIndex={0}
              aria-label={`Contents of ${file.path}`}
              className="max-h-[36rem] flex-1 overflow-auto p-4 font-mono text-[12px] leading-relaxed text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/50"
            >
              {file.content || "(empty file)"}
            </pre>
          </>
        ) : (
          <p className="p-6 text-sm text-zinc-500">Select a file to preview it.</p>
        )}
      </div>
    </div>
  );
}
