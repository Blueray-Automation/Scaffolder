#!/usr/bin/env node
// Builds the standalone command-line package (what `npx ai-scaffolder` runs) into dist/cli:
//   index.js      the whole CLI in one file: the engine, every template and its three small dependencies are inside it
//   package.json  a small one of its own (the repository's package.json is private and lists the web UI's dependencies)
//   README.md, LICENSE
// Usage:  npm run build:cli [-- --out <dir>] [-- --version <x.y.z>]      then:  cd dist/cli && npm publish --access public
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
export const NPM_NAME = "ai-scaffolder";
const DEFAULT_VERSION = "0.1.0";

const { values } = parseArgs({ options: { out: { type: "string" }, version: { type: "string" } } });
const out = resolve(values.out ?? join(repo, "dist", "cli"));
const version = values.version ?? DEFAULT_VERSION;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`not a version: ${version}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// the templates are compiled into the engine first, so the bundle always carries the current ones
execFileSync(process.execPath, [join(repo, "scripts", "bundle-templates.mjs")], { stdio: "inherit" });

await build({
  entryPoints: [join(repo, "cli", "index.ts")],
  outfile: join(out, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  logLevel: "warning",
  // what the program is called in its own help text: `scaffolder` from a clone, the package's name from npm
  define: { "process.env.SCAFFOLDER_BIN": JSON.stringify(NPM_NAME), "process.env.SCAFFOLDER_VERSION": JSON.stringify(version) },
  // the bundled CommonJS dependencies may `require` a Node built-in
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});

// the source's own first line runs it with tsx; the package runs with plain node
const bundled = readFileSync(join(out, "index.js"), "utf8").replace(/^#!.*\n/, "");
writeFileSync(join(out, "index.js"), `#!/usr/bin/env node\n${bundled}`);
chmodSync(join(out, "index.js"), 0o755);

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: NPM_NAME,
      version,
      description: "Generate AI-ready full-stack projects where done is proven, or add a verification loop and an .ai/ operating system to a repository you already have.",
      license: "MIT",
      // npm's trusted publishing from GitHub Actions requires this to match the repository that runs the release workflow exactly
      repository: { type: "git", url: "git+https://github.com/Blueray-Automation/Scaffolder.git" },
      type: "module",
      bin: { [NPM_NAME]: "index.js" },
      files: ["index.js", "README.md", "LICENSE"],
      engines: { node: ">=20" },
      keywords: ["scaffold", "ai", "agents", "verification", "sdlc", "codegen", "adopt", "AGENTS.md"],
    },
    null,
    2,
  ) + "\n",
);
copyFileSync(join(repo, "packaging", "npm-README.md"), join(out, "README.md"));
copyFileSync(join(repo, "LICENSE"), join(out, "LICENSE"));

const kb = Math.round(statSync(join(out, "index.js")).size / 1024);
console.log(`built ${NPM_NAME}@${version} in ${out} (index.js ${kb} KB)`);
