import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { ExistingProject } from "@/components/ExistingProject";

export const metadata: Metadata = {
  title: "Existing project | Scaffolder",
  description: "Add the .ai/ verification setup to a repository you already have: one command, then a baseline so nothing that passed yesterday fails today.",
};

export default function ExistingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader active="existing" />
      <main id="content" className="flex-1">
        <ExistingProject />
      </main>
    </div>
  );
}
