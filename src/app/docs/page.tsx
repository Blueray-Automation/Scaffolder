import { DocPageView } from "@/components/DocPageView";
import { findDoc } from "@/lib/docs";

export default function DocsHome() {
  const page = findDoc("Home");
  if (!page) throw new Error("docs/wiki/Home.md is missing");
  return <DocPageView page={page} />;
}
