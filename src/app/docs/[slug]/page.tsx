import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPageView } from "@/components/DocPageView";
import { DOC_ORDER, findDoc } from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_ORDER.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = findDoc(slug);
  return { title: page ? (page.kind === "readme" ? "README" : page.title) : "Not found" };
}

export default async function DocRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = findDoc(slug);
  if (!page) notFound();
  return <DocPageView page={page} />;
}
