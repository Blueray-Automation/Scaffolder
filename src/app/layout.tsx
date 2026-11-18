import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scaffolder | AI-ready projects, verified end to end",
  description:
    "Configure a full-stack project and generate it with PRD-driven verification loops, tests, CI/CD and a working hello world. Same engine in the browser and the CLI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}
