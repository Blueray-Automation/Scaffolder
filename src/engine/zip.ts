import { strToU8, zipSync, type Zippable } from "fflate";
import type { GeneratedFile } from "./generate";

/** Zip the generated project under a `<root>/` folder, preserving the executable bit. */
export function toZip(files: GeneratedFile[], rootDir: string): Uint8Array {
  const entries: Zippable = {};
  const mtime = new Date(Date.UTC(2020, 0, 1)); // fixed: identical config => identical zip
  for (const f of files) {
    const mode = f.executable ? 0o100755 : 0o100644;
    entries[`${rootDir}/${f.path}`] = [strToU8(f.content), { mtime, os: 3, attrs: mode * 0x10000 }];
  }
  return zipSync(entries, { level: 6 });
}

/** ASCII tree of generated paths, for previews and CLI output. */
export function renderTree(paths: string[], rootName: string): string {
  interface Node {
    [name: string]: Node;
  }
  const tree: Node = {};
  for (const p of paths) {
    let node = tree;
    for (const part of p.split("/")) node = node[part] ??= {};
  }
  const lines: string[] = [`${rootName}/`];
  const walk = (node: Node, prefix: string) => {
    const names = Object.keys(node).sort((a, b) => {
      const ad = Object.keys(node[a]).length > 0;
      const bd = Object.keys(node[b]).length > 0;
      return ad === bd ? a.localeCompare(b) : ad ? -1 : 1;
    });
    names.forEach((name, i) => {
      const last = i === names.length - 1;
      const isDir = Object.keys(node[name]).length > 0;
      lines.push(`${prefix}${last ? "└── " : "├── "}${name}${isDir ? "/" : ""}`);
      if (isDir) walk(node[name], prefix + (last ? "    " : "│   "));
    });
  };
  walk(tree, "");
  return lines.join("\n");
}
