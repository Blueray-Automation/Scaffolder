"use client";

import React from "react";

/**
 * The rendered HTML of one documentation page. It comes from the repository's own markdown, converted at build time
 * (scripts/bundle-docs.mjs), so it is trusted content; the only behaviour added here is the Copy button on code blocks.
 */
export function DocArticle({ html, title }: { html: string; title: string }) {
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    if (!button) return;
    const code = button.parentElement?.querySelector("pre")?.textContent ?? "";
    navigator.clipboard.writeText(code).then(
      () => {
        button.textContent = "Copied";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 1500);
      },
      () => {
        /* clipboard unavailable: the text can still be selected */
      },
    );
  };
  return <article aria-label={title} className="doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
