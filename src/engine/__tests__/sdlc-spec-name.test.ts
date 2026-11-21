import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config";
import { generateProject } from "../generate";

/**
 * `sdlc spec requirements.pdf` used to name the spec folder after the file (FEAT-001-requirements). The folder is now named
 * after the feature in the PRD's own title (FEAT-001-customer-login), unless the person passes --name.
 */
const PROBE = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("sdlc", "scripts/sdlc.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps(eval(sys.argv[1], {"m": m, "Path": m.Path, "json": json})))
`;

function withProject<T>(run: (dir: string, py: (expr: string) => T, sdlc: (...args: string[]) => { status: number | null; out: string }) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "scaffolder-name-"));
  try {
    for (const f of generateProject(defaultConfig()).files) {
      const target = join(dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    writeFileSync(join(dir, "probe.py"), PROBE);
    const py = (expr: string): T => {
      const r = spawnSync("python3", ["-I", join(dir, "probe.py"), expr], { cwd: dir, encoding: "utf8", timeout: 60_000 });
      if (r.error) throw r.error;
      if (r.status !== 0) throw new Error(r.stderr);
      return JSON.parse(r.stdout.trim().split("\n").pop()!) as T; // the function may say something first; the answer is the last line
    };
    const sdlc = (...args: string[]) => {
      const r = spawnSync("python3", ["-I", join(dir, "scripts", "sdlc.py"), ...args], { cwd: dir, encoding: "utf8", timeout: 60_000 });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    };
    run(dir, py, sdlc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hasPython = spawnSync("python3", ["--version"]).error === undefined;
const it_ = hasPython ? it : it.skip;

describe("sdlc spec: the folder is named after the feature, not the file", () => {
  it_("reads the feature name from the PRD title and ignores words that only describe the document", () => {
    withProject<string | null>((_dir, py) => {
      const slug = (title: string) => py(`m.feature_slug_from_prd(${JSON.stringify(title)})`);
      expect(slug("# FEAT-001: Customer Login\n\nStatus: Draft")).toBe("customer-login");
      expect(slug("# FEAT-001: Customer Login Requirements")).toBe("customer-login");
      expect(slug("# FEAT-001: Requirements for Customer Login")).toBe("customer-login");
      expect(slug("\n# FEAT-002 – Password Reset")).toBe("password-reset");
      expect(slug("# FEAT-001: Document Upload"), "only trailing document words go").toBe("document-upload");
      expect(slug("# FEAT-001: Export orders to CSV for the finance team every night")).toBe("export-orders-to-csv-for");
      // nothing about the feature: keep the name the folder has
      expect(slug("# FEAT-001: Requirements")).toBeNull();
      expect(slug("# FEAT-001: Requirements Document")).toBeNull();
      expect(slug("# FEAT-001: TODO(prd): title")).toBeNull();
      expect(slug("# Customer Login")).toBeNull();
      expect(slug("")).toBeNull();
    });
  });

  it_("renames the folder, rewrites the paths the draft cites, and keeps the name when it would collide", () => {
    withProject<unknown>((dir, py) => {
      const specs = join(dir, ".ai", "specs");
      const draft = (folder: string, title: string) => {
        mkdirSync(join(specs, folder, "source"), { recursive: true });
        writeFileSync(join(specs, folder, "prd.md"), `# FEAT-001: ${title}\n\n- **AC-001** Given a user, when they log in, then ok (Source: .ai/specs/${folder}/source/requirements.pdf p.2)\n`);
        writeFileSync(join(specs, folder, "acceptance.json"), JSON.stringify({ feature: "FEAT-001", checks: [], note: `.ai/specs/${folder}/source/requirements.pdf` }));
      };
      const run = (folder: string) => py(`m.name_spec_after_feature(m.ROOT / ".ai/specs", m.ROOT / ".ai/specs/${folder}").name`) as string; // m.ROOT is the resolved project path, as in real use

      draft("FEAT-001-requirements", "Customer Login");
      expect(run("FEAT-001-requirements")).toBe("FEAT-001-customer-login");
      expect(existsSync(join(specs, "FEAT-001-requirements"))).toBe(false);
      const prd = readFileSync(join(specs, "FEAT-001-customer-login", "prd.md"), "utf8");
      expect(prd).toContain(".ai/specs/FEAT-001-customer-login/source/requirements.pdf");
      expect(prd).not.toContain("FEAT-001-requirements");
      expect(readFileSync(join(specs, "FEAT-001-customer-login", "acceptance.json"), "utf8")).toContain(".ai/specs/FEAT-001-customer-login/source/requirements.pdf");

      // a title that says nothing about the feature leaves the name alone
      draft("FEAT-002-requirements", "Requirements");
      expect(run("FEAT-002-requirements")).toBe("FEAT-002-requirements");

      // another spec already has that name: keep ours rather than overwrite or guess a suffix
      draft("FEAT-003-requirements", "Customer Login");
      expect(run("FEAT-003-requirements")).toBe("FEAT-003-requirements");
      expect(existsSync(join(specs, "FEAT-001-customer-login"))).toBe(true);
    });
  });

  it_("finds a spec by the document it was drafted from, even after it was renamed", () => {
    withProject<string[]>((dir, py) => {
      const specs = join(dir, ".ai", "specs");
      writeFileSync(join(dir, "requirements.md"), "# Customer login\nA customer logs in.\n");
      mkdirSync(join(specs, "FEAT-001-customer-login", "source"), { recursive: true });
      writeFileSync(join(specs, "FEAT-001-customer-login", "source", "requirements.md"), "# Customer login\nA customer logs in.\n");
      mkdirSync(join(specs, "FEAT-002-billing", "source"), { recursive: true });
      writeFileSync(join(specs, "FEAT-002-billing", "source", "requirements.md"), "a different requirements.md\n");
      const found = py(`[p.name for p in m.spec_dirs_made_from(m.ROOT / ".ai/specs", m.ROOT / "requirements.md")]`);
      expect(found).toEqual(["FEAT-001-customer-login"]);
    });
  });

  it_("a dry run says the name comes from the feature, and --name fixes it up front", () => {
    withProject<unknown>((dir, _py, sdlc) => {
      writeFileSync(join(dir, "requirements.md"), "# Customer login\n\nA customer logs in with an email and a password.\n");
      const plain = sdlc("spec", "requirements.md", "--dry-run", "--allow-dirty", "--agent", "cat");
      expect(plain.status, plain.out).toBe(0);
      expect(plain.out).toContain(".ai/specs/FEAT-001-<feature name>/");
      expect(plain.out).toContain("named after the feature in the PRD's title");
      expect(plain.out).not.toContain("FEAT-001-requirements");

      const named = sdlc("spec", "requirements.md", "--dry-run", "--allow-dirty", "--agent", "cat", "--name", "customer-login");
      expect(named.status, named.out).toBe(0);
      expect(named.out).toContain("would create  : .ai/specs/FEAT-001-customer-login/");
      expect(named.out).not.toContain("<feature name>");
    });
  });
});
