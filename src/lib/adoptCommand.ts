/** The command a person types to add the `.ai/` setup to a repository they already have. Pure, so the page and its tests share it. */

export const NPM_PACKAGE = "ai-scaffolder";
export const DEFAULT_AGENT_PRESET = "claude";

export interface AdoptCommandOptions {
  /** The repository's folder, as the person will type it. Empty means the folder they are in. */
  dir: string;
  /** Off = a dry run that only shows what it found. */
  write: boolean;
  /** Overwrite files this tool generated on an earlier run (never files of the person's own). */
  force: boolean;
  /** On = do not touch AGENTS.md: write only inside `.ai/`. */
  leaveAgentsMd: boolean;
  /** An agent preset id (see AGENT_PRESETS). */
  agentPreset: string;
}

/** POSIX-shell quoting (also right for PowerShell): leave plain words alone, single-quote everything else. */
export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  // a leading ~/ must stay outside the quotes, or the shell takes it for a folder literally named "~"
  if (arg.startsWith("~/")) return arg.length === 2 ? "~/" : `~/${shellQuote(arg.slice(2))}`;
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

export function buildAdoptCommand(o: AdoptCommandOptions): string {
  const parts = ["npx", NPM_PACKAGE, "adopt", shellQuote(o.dir.trim() || ".")];
  if (o.write) parts.push("--write");
  if (o.force) parts.push("--force");
  if (o.leaveAgentsMd) parts.push("--set", "rootFile=none");
  if (o.agentPreset && o.agentPreset !== DEFAULT_AGENT_PRESET) parts.push("--set", `sdlc.agent.preset=${o.agentPreset}`);
  return parts.join(" ");
}
