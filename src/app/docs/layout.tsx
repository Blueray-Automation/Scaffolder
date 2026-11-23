import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { DocsNav } from "@/components/DocsNav";

export const metadata: Metadata = {
  title: { default: "Docs | Scaffolder", template: "%s | Scaffolder docs" },
  description: "The whole Scaffolder workflow, from setup to adopting an existing project: the README and every wiki page, readable here.",
};

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader active="docs" />
      <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-auto">
          <DocsNav />
        </aside>
        <main id="content" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
