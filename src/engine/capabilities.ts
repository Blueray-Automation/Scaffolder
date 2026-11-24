/**
 * Capability registry: the single source of truth for what the engine can
 * generate today. The UI renders options from it, the validator enforces it,
 * and the CLI lists it. Adding a new stack = add a pack + flip `available`.
 */

export interface Option {
  id: string;
  label: string;
  /** false = planned but no pack exists yet; selecting it is a validation error. */
  available: boolean;
  hint?: string;
}

export interface VersionedOption extends Option {
  versions: string[];
}

export interface BackendLanguageOption extends Option {
  frameworks: VersionedOption[];
}

export const CAPABILITIES = {
  backend: {
    languages: [
      {
        id: "python",
        label: "Python",
        available: true,
        frameworks: [
          { id: "fastapi", label: "FastAPI", available: true, versions: ["3.13", "3.12", "3.11"] },
          { id: "django-ninja", label: "Django Ninja", available: false, versions: ["3.12"] },
        ],
      },
      {
        id: "node",
        label: "Node.js",
        available: false,
        frameworks: [{ id: "nestjs", label: "NestJS", available: false, versions: ["22", "20"] }],
      },
      {
        id: "java",
        label: "Java",
        available: false,
        frameworks: [{ id: "spring-boot", label: "Spring Boot 3", available: false, versions: ["21", "17"] }],
      },
      {
        id: "go",
        label: "Go",
        available: false,
        frameworks: [{ id: "gin", label: "Gin", available: false, versions: ["1.23"] }],
      },
    ] as BackendLanguageOption[],
  },
  web: {
    frameworks: [
      { id: "nextjs", label: "Next.js 16 (App Router)", available: true, versions: ["24", "22"] },
      { id: "react", label: "React + Vite", available: false, versions: ["24", "22"] },
      { id: "vue", label: "Vue 3 + Vite", available: false, versions: ["24", "22"] },
      { id: "nuxt", label: "Nuxt 4 (Vue 3)", available: true, versions: ["24", "22"] },
    ] as VersionedOption[],
  },
  mobile: {
    frameworks: [
      { id: "flutter", label: "Flutter", available: true, versions: ["3.50"] },
      { id: "react-native", label: "React Native", available: false, versions: [] },
      { id: "android", label: "Android (native)", available: false, versions: [] },
      { id: "ios", label: "iOS (native)", available: false, versions: [] },
    ] as VersionedOption[],
  },
  database: [
    { id: "none", label: "None", available: true },
    { id: "postgres", label: "PostgreSQL", available: true, versions: ["17", "16", "15"] },
    { id: "mysql", label: "MySQL", available: false, versions: ["8.4"] },
    { id: "mongodb", label: "MongoDB", available: false, versions: ["7"] },
  ] as VersionedOption[],
  cache: [
    { id: "none", label: "None", available: true },
    { id: "redis", label: "Redis", available: false },
  ] as Option[],
  auth: [
    { id: "none", label: "None", available: true },
    { id: "jwt", label: "JWT", available: false },
    { id: "session", label: "Session cookies", available: false },
    { id: "keycloak", label: "Keycloak (OIDC)", available: false },
  ] as Option[],
  ci: [
    { id: "github-actions", label: "GitHub Actions", available: true },
    { id: "gitlab-ci", label: "GitLab CI", available: false },
    { id: "none", label: "None", available: true },
  ] as Option[],
  registry: [
    { id: "ghcr", label: "GitHub Container Registry", available: true },
    { id: "dockerhub", label: "Docker Hub", available: false },
    { id: "none", label: "None (build only)", available: true },
  ] as Option[],
  deployTarget: [
    { id: "none", label: "Placeholder (prints the plan)", available: true },
    { id: "ssh-compose", label: "SSH + docker compose", available: true },
    { id: "kubernetes", label: "Kubernetes (Helm)", available: false },
  ] as Option[],
  runtime: [
    { id: "docker", label: "Docker Compose", available: true, hint: "Closest to production; needs Docker." },
    { id: "local", label: "Local processes", available: true, hint: "No Docker; DB-dependent checks are skipped." },
    { id: "none", label: "None", available: true, hint: "Skip runtime fact probes." },
  ] as Option[],
  license: [
    { id: "MIT", label: "MIT", available: true },
    { id: "UNLICENSED", label: "Proprietary", available: true },
  ] as Option[],
} as const;

export interface AgentPresetOption extends Option {
  /**
   * "headless": the tool starts a program and reads its result (a CLI, or the Claude desktop app's own engine).
   * "handoff": a desktop app the person drives: the tool opens it, puts the instruction where it can be pasted,
   * waits for the person, then verifies. "manual": a human does the coding, with whatever tools they like.
   */
  mode: "headless" | "handoff" | "manual";
  /**
   * The shell command the preset stands for. It reads the prompt on stdin, or names it with `{prompt_file}`
   * (the tool replaces that with the path of the prompt it wrote). `{claude_desktop}` stands for the Claude Code that
   * the Claude desktop app keeps (the tool finds it). `handoff:<app>` is a desktop app from DESKTOP_APPS.
   * Empty = none / user-defined.
   */
  command: string;
  /** The program that command starts: how the tool tells whether the agent is installed. Empty = none / user-defined / a hand-off. */
  program: string;
  /** One line that installs it, shown whenever the program is missing. Empty = none / user-defined. */
  install: string;
  /** The tool's own documentation for its non-interactive mode. */
  docs: string;
}

/** The prefix of an agent command that hands the work to a desktop app (see DESKTOP_APPS) instead of running a program. */
export const HANDOFF_PREFIX = "handoff:";

export interface DesktopAppOption extends Option {
  /**
   * How the tool opens the app, per operating system: argument lists, tried in order until one succeeds. `{dir}` is the
   * project folder, `{query}` the instruction, URL-encoded. Opening is a convenience: if it fails the person is told
   * to open the app themselves, and the hand-off goes on.
   */
  open: { macos: string[][]; windows: string[][]; linux: string[][] };
  /** Where the tool looks to say "found here": files or folders (`~` and %VARS% are expanded) per OS, and commands on PATH. */
  detect: { macos: string[]; windows: string[]; which: string[] };
  /** What the person does inside the app. */
  steps: string;
  install: string;
  docs: string;
}

/**
 * Desktop coding-agent apps the person can drive. The tool cannot run these headlessly (they have no command to run), so
 * it opens the app, puts the instruction on the clipboard, waits for "Enter", and then does everything else itself:
 * check the draft, install dependencies, verify against the running system, heal. Only the Claude desktop app's
 * `claude://code/new` link is documented (https://code.claude.com/docs/en/desktop); the Cursor and VS Code launchers are
 * their usual open-this-folder commands. None of these has been run against the real apps on every platform.
 */
export const DESKTOP_APPS: DesktopAppOption[] = [
  {
    id: "claude",
    label: "Claude desktop app",
    available: true,
    open: {
      macos: [["open", "claude://code/new?q={query}"]],
      windows: [["cmd", "/c", "start", "", "claude://code/new?q={query}"]],
      linux: [["xdg-open", "claude://code/new?q={query}"]],
    },
    detect: {
      macos: ["/Applications/Claude.app", "~/Applications/Claude.app"],
      windows: ["%LOCALAPPDATA%\\AnthropicClaude", "%LOCALAPPDATA%\\Programs\\Claude"],
      which: [],
    },
    steps:
      "In the Claude desktop app's Code tab a new session opens with the instruction in the prompt box (it is also on your clipboard). " +
      "Choose this project's folder, check the permission mode, and send it.",
    install: "install the Claude desktop app: https://claude.ai/download",
    docs: "https://code.claude.com/docs/en/desktop",
    hint: "Opens a new Code-tab session with the instruction filled in; you choose the folder and press send.",
  },
  {
    id: "cursor",
    label: "Cursor",
    available: true,
    open: {
      macos: [["open", "-a", "Cursor", "{dir}"]],
      windows: [["cursor", "{dir}"]],
      linux: [["cursor", "{dir}"]],
    },
    detect: { macos: ["/Applications/Cursor.app", "~/Applications/Cursor.app"], windows: ["%LOCALAPPDATA%\\Programs\\cursor"], which: ["cursor"] },
    steps: "Cursor opens on this project. Open its agent chat, paste the instruction (it is on your clipboard) and let the agent work.",
    install: "install Cursor: https://cursor.com/download",
    docs: "https://cursor.com/docs",
    hint: "Opens this folder in Cursor; you paste the instruction into its agent chat.",
  },
  {
    id: "vscode",
    label: "VS Code",
    available: true,
    open: {
      macos: [["open", "-a", "Visual Studio Code", "{dir}"]],
      windows: [["code", "{dir}"]],
      linux: [["code", "{dir}"]],
    },
    detect: { macos: ["/Applications/Visual Studio Code.app", "~/Applications/Visual Studio Code.app"], windows: ["%LOCALAPPDATA%\\Programs\\Microsoft VS Code"], which: ["code"] },
    steps: "VS Code opens on this project. Open the agent chat of the extension you use (Copilot Chat in Agent mode, or the Claude Code panel), paste the instruction (it is on your clipboard) and let it work.",
    install: "install VS Code: https://code.visualstudio.com/download",
    docs: "https://code.visualstudio.com/docs/copilot/agents/overview",
    hint: "Opens this folder in VS Code; you paste the instruction into the agent chat of the extension you use.",
  },
];

/**
 * Agent presets for `./scripts/sdlc spec | implement | loop`. They follow each tool's documented non-interactive mode
 * (see `docs`) but have NOT been run against the real tools here; the flags can change, so check `<tool> --help`.
 * They are defaults: override with `sdlc.agent.command`, or pick another with `./scripts/sdlc agent`.
 * Any other agent works as a custom command that reads the prompt on stdin.
 *
 * Desktop applications are covered two ways: `claude-desktop` runs the Claude Code that the Claude desktop app keeps for its
 * Code tab (unattended, like `claude -p`), and the `handoff-*` presets open a desktop app and wait for the person (see DESKTOP_APPS).
 */
export const AGENT_PRESETS: AgentPresetOption[] = [
  {
    id: "claude",
    mode: "headless",
    label: "Claude Code (claude -p)",
    available: true,
    command: 'claude -p --permission-mode acceptEdits --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Bash"',
    program: "claude",
    install: "npm install -g @anthropic-ai/claude-code",
    docs: "https://code.claude.com/docs/en/headless",
    hint: "Needs the Claude Code CLI on PATH. Bash is pre-approved so the agent can run the tests.",
  },
  {
    id: "codex",
    mode: "headless",
    label: "OpenAI Codex (codex exec)",
    available: true,
    command: "codex exec --sandbox workspace-write -",
    program: "codex",
    install: "npm install -g @openai/codex",
    docs: "https://developers.openai.com/codex/noninteractive",
    hint: "Needs the Codex CLI on PATH. The sandbox may block network access; `sdlc sync` installs dependencies outside it.",
  },
  {
    id: "gemini",
    mode: "headless",
    label: "Google Gemini CLI (gemini -p)",
    available: true,
    command: 'gemini --approval-mode yolo -p "Carry out the instructions given above."',
    program: "gemini",
    install: "npm install -g @google/gemini-cli",
    docs: "https://geminicli.com/docs/cli/headless/",
    hint: "Needs the Gemini CLI on PATH. `yolo` approves every action (needed to run the tests): work on a branch and read the diff.",
  },
  {
    id: "copilot",
    mode: "headless",
    label: "GitHub Copilot CLI (copilot -p)",
    available: true,
    command: 'copilot -p "Read {prompt_file} and do exactly what it says." --allow-all-tools',
    program: "copilot",
    install: "npm install -g @github/copilot",
    docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically",
    hint: "Needs the Copilot CLI on PATH and a Copilot subscription. It takes the prompt as an argument, so it is pointed at the prompt file.",
  },
  {
    id: "cursor",
    mode: "headless",
    label: "Cursor CLI (cursor-agent -p)",
    available: true,
    command: 'cursor-agent -p --force "Read {prompt_file} and do exactly what it says."',
    program: "cursor-agent",
    install: "see https://cursor.com/cli",
    docs: "https://cursor.com/docs/cli/headless",
    hint: "Needs the Cursor CLI on PATH (its command may be `agent` on newer installs: use a custom command then). `--force` lets it edit files.",
  },
  {
    id: "claude-desktop",
    mode: "headless",
    label: "Claude desktop engine (unattended)",
    available: true,
    command: '{claude_desktop} -p --permission-mode acceptEdits --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Bash"',
    program: "{claude_desktop}",
    install: "install the Claude desktop app: https://claude.ai/download",
    docs: "https://code.claude.com/docs/en/desktop",
    hint: "Runs the Claude Code that the Claude desktop app keeps up to date for its Code tab, headless, like `claude -p`: no CLI on PATH, so an old `claude` install cannot get in the way.",
  },
  ...DESKTOP_APPS.map(
    (app): AgentPresetOption => ({
      id: `handoff-${app.id}`,
      mode: "handoff",
      label: `${app.label} (you drive it)`,
      available: true,
      command: `${HANDOFF_PREFIX}${app.id}`,
      program: "",
      install: app.install,
      docs: app.docs,
      hint: `${app.hint ?? ""} The tool then waits for you, and checks and verifies the result itself.`.trim(),
    }),
  ),
  { id: "custom", mode: "headless", label: "Custom command", available: true, command: "", program: "", install: "", docs: "", hint: "Any CLI that reads the prompt on stdin (or use {prompt_file} in the command)." },
  { id: "none", mode: "manual", label: "None (a human does the coding)", available: true, command: "", program: "", install: "", docs: "", hint: "The loop prints the prompt and waits." },
];

export function findOption<T extends Option>(list: readonly T[], id: string): T | undefined {
  return list.find((o) => o.id === id);
}

export function availableIds(list: readonly Option[]): string[] {
  return list.filter((o) => o.available).map((o) => o.id);
}
