import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI SDLC Scaffolder | Multi-Stack Boilerplate & Loop Engine Generator",
  description:
    "Configure microservices, full-stack web, mobile, or monolith architectures with embedded AI SDLC rules, Docker Compose, CI/CD, and self-healing verification loops.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}
