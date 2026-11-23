import { DOC_PAGES, type DocPage } from "@/docs.generated";

/** Server-side access to the rendered documentation (README and the wiki pages), in reading order. */
export const DOC_ORDER: readonly DocPage[] = DOC_PAGES;

export function findDoc(slug: string): DocPage | undefined {
  return DOC_ORDER.find((p) => p.slug === slug);
}

export function neighbours(slug: string): { previous?: DocPage; next?: DocPage } {
  const i = DOC_ORDER.findIndex((p) => p.slug === slug);
  return { previous: i > 0 ? DOC_ORDER[i - 1] : undefined, next: i >= 0 && i < DOC_ORDER.length - 1 ? DOC_ORDER[i + 1] : undefined };
}

/** Where the page's text lives in the repository (the reader may want to know, and it is the file to edit). */
export function sourceFile(page: DocPage): string {
  return page.kind === "readme" ? "README.md" : `docs/wiki/${page.slug}.md`;
}
