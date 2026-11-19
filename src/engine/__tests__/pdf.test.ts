import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config";
import { generateProject } from "../generate";

/**
 * The built-in PDF reader is what `sdlc spec` falls back to when no pdftotext / pypdf / mutool is installed, which is the
 * normal situation on a fresh Windows machine. It must read what browsers and word processors produce.
 *
 * docs/samples/requirements.pdf was printed to PDF by Chrome, which positions every glyph with its own `x 0 Td` and
 * writes spaces as real glyphs. The reader once turned each move into a space ("C u s t o m e r") and then, rightly,
 * refused the text as garbled.
 */
const SAMPLE = fileURLToPath(new URL("../../../docs/samples/requirements.pdf", import.meta.url));

const PROBE = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("sdlc", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with open(sys.argv[2], "rb") as f:
    text = m.pdf_text_builtin(f.read())
print(json.dumps({"text": text, "usable": m.looks_like_text(text)}))
`;

describe("sdlc spec: the built-in PDF reader", () => {
  it("reads the Chrome-made sample requirements document with normal word spacing", () => {
    const sdlc = generateProject(defaultConfig()).files.find((f) => f.path === "scripts/sdlc.py")!.content;
    const dir = mkdtempSync(join(tmpdir(), "scaffolder-pdf-"));
    try {
      writeFileSync(join(dir, "sdlc.py"), sdlc);
      writeFileSync(join(dir, "probe.py"), PROBE);
      const run = spawnSync("python3", ["-I", join(dir, "probe.py"), join(dir, "sdlc.py"), SAMPLE], { encoding: "utf8", timeout: 60_000 });
      if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") return; // no python3 here
      expect(run.status, run.stderr).toBe(0);
      const { text, usable } = JSON.parse(run.stdout) as { text: string; usable: boolean };
      expect(usable, `the extraction was rejected as garbled:\n${text.slice(0, 300)}`).toBe(true);
      for (const phrase of [
        "Customer Login",
        "/api/v1/auth/login",
        "Invalid email or password",
        "demo@example.com",
        "R7. If the token is missing, malformed or expired",
        "R1. A client logs in by sending a POST request to /api/v1/auth/login",
        "Signing key Comes from the environment variable JWT_SECRET", // a table row: cells are separated
        "demo@example.com demo-pass",
        "This first release is deliberately small", // "first" is written with a ligature glyph in the PDF
        "Out of scope for this release",
      ]) {
        expect(text, `missing "${phrase}"`).toContain(phrase);
      }
      expect(text).not.toMatch(/C u s t o m e r/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
