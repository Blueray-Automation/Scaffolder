import Link from "next/link";
import { Cpu } from "lucide-react";
import { cx } from "@/lib/utils";

const NAV = [
  { id: "new", href: "/", label: "New project" },
  { id: "existing", href: "/existing", label: "Existing project" },
  { id: "docs", href: "/docs", label: "Docs" },
] as const;

export type NavId = (typeof NAV)[number]["id"];

/** The header every page shares: the name, the three places you can go, and the PRD -> Deploy pipeline this tool is about. */
export function AppHeader({ active }: { active: NavId }) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-600/20 text-indigo-400">
              <Cpu className="h-5 w-5" aria-hidden />
            </span>
            <span>
              <span className="block text-base font-semibold tracking-tight text-zinc-100">Scaffolder</span>
              <span className="hidden text-xs text-zinc-400 sm:block">AI-ready projects, verified end to end</span>
            </span>
          </Link>
          <nav aria-label="Main">
            <ul className="flex items-center gap-1">
              {NAV.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={item.id === active ? "page" : undefined}
                    className={cx(
                      "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
                      item.id === active ? "bg-indigo-600/25 text-zinc-50" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <ol className="hidden items-center gap-1.5 text-xs text-zinc-400 xl:flex" aria-label="Pipeline">
          {["PRD", "Code", "Test", "Deploy"].map((step, i) => (
            <li key={step} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>→</span>}
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-200">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </header>
  );
}
