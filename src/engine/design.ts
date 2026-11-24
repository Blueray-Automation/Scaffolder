import type { ScaffolderConfig } from "./config";
import { mobileStack } from "./mobileStacks";
import { webStack } from "./webStacks";

/**
 * The design contract: one committed file of design tokens (`.ai/design/tokens.json`) that the screens are built from,
 * the way `.ai/contract/openapi.json` is the contract of the API. Per-stack files are GENERATED from it (a stylesheet
 * of CSS variables for the web, a Dart class for Flutter), and a gate fails when they drift from it or when a screen
 * hard-codes a colour, spacing, radius or type size instead of using a token.
 *
 * The generators here run once, when the project is created. `scripts/sdlc.py` has the same generators (`sdlc design
 * sync`), because a generated project must be able to resync without Node. `design.test.ts` runs both on the same
 * tokens and requires byte-identical output: change one, change the other.
 */

export const TOKENS_PATH = ".ai/design/tokens.json";

export const TOKEN_TYPES = ["color", "dimension", "fontFamily", "fontWeight"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/** Colours every generated theme needs: the Flutter theme and the shipped styles refer to these by name. */
export const REQUIRED_COLORS = ["accent", "bg", "border", "card", "danger", "fg", "muted"];

/** A token after validation: a value in its canonical spelling, and for colours the dark-theme value if there is one. */
export interface Token {
  path: string[];
  type: TokenType;
  value: string;
  dark: string | null;
}

type Json = Record<string, unknown>;

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const DIMENSION = /^(-?\d+(?:\.\d+)?)(px|rem|em)$/;
/** Words a Dart field cannot be named (a colour called `default` would not compile). */
const DART_RESERVED = new Set(
  (
    "abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export " +
    "extends extension external factory false final finally for get if implements import in interface is late library mixin new " +
    "null of on operator part required rethrow return sealed set static super switch this throw true try typedef var void while with yield"
  ).split(" "),
);

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The tokens a new project starts with: the look of the shipped hello page, named so a design tool can export the same names. */
export function defaultTokens(): Json {
  const colour = (light: string, dark: string) => ({ $value: light, $extensions: { scaffolder: { dark } } });
  return {
    $description:
      "Design tokens: the one source of truth for colours, spacing, radius and type. Change them here (or import them from your design tool), then run `./scripts/sdlc design sync`. Never edit the generated files.",
    color: {
      $type: "color",
      bg: colour("#fafafa", "#09090b"),
      fg: colour("#18181b", "#fafafa"),
      muted: colour("#71717a", "#a1a1aa"),
      card: colour("#ffffff", "#18181b"),
      border: colour("#e4e4e7", "#27272a"),
      accent: colour("#4f46e5", "#818cf8"),
      danger: colour("#b91c1c", "#f87171"),
    },
    space: {
      $type: "dimension",
      xs: { $value: "0.25rem" },
      sm: { $value: "0.5rem" },
      md: { $value: "1rem" },
      lg: { $value: "1.5rem" },
      xl: { $value: "2rem" },
    },
    radius: {
      $type: "dimension",
      sm: { $value: "0.375rem" },
      md: { $value: "0.5rem" },
      lg: { $value: "0.75rem" },
    },
    font: {
      family: { $type: "fontFamily", base: { $value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' } },
      size: {
        $type: "dimension",
        sm: { $value: "0.8rem" },
        base: { $value: "1rem" },
        xl: { $value: "2rem" },
      },
      weight: { $type: "fontWeight", regular: { $value: 400 }, semibold: { $value: 600 } },
      tracking: { $type: "dimension", wide: { $value: "0.08em" } },
    },
    size: { $type: "dimension", content: { $value: "32rem" } },
  };
}

export function tokensFile(): string {
  return JSON.stringify(defaultTokens(), null, 2) + "\n";
}

function value(kind: TokenType, raw: unknown, label: string, problems: string[]): string | null {
  if (kind === "color") {
    if (typeof raw === "string" && HEX_COLOR.test(raw)) return raw.toLowerCase();
    problems.push(`${label}: a colour is written #rrggbb or #rrggbbaa`);
  } else if (kind === "dimension") {
    const m = typeof raw === "string" ? DIMENSION.exec(raw) : null;
    if (m) return raw as string;
    problems.push(`${label}: a dimension is a number and a unit (px, rem or em), such as "1.5rem"`);
  } else if (kind === "fontFamily") {
    if (typeof raw === "string" && raw.trim() !== "" && !/[;{}\r\n]|\/\*/.test(raw)) return raw.trim();
    problems.push(`${label}: a font family is a non-empty font stack on one line`);
  } else {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (Number.isInteger(n) && n >= 100 && n <= 900 && n % 100 === 0) return String(n);
    problems.push(`${label}: a font weight is 100, 200, ... 900`);
  }
  return null;
}

/** The unit of a dimension value ("rem" for "1.5rem"). */
const unitOf = (v: string): string => (DIMENSION.exec(v) as RegExpExecArray)[2] as string;

/** Flutter has no `em` (it is relative to a font size the app does not know here), so such a dimension stays on the web. */
const inDart = (t: Pick<Token, "type" | "value">): boolean => t.type === "color" || t.type === "fontWeight" || (t.type === "dimension" && unitOf(t.value) !== "em");

/** `--color-bg` for `["color", "bg"]`: the CSS variable a token becomes. */
export const cssName = (path: string[]): string => `--${path.join("-")}`;

/** `onAccent` for `["on-accent"]`: the Dart name of a token. */
function camel(parts: string[]): string {
  return parts
    .join("-")
    .split("-")
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

/** The Dart name of a token: a colour is a field of `TokenColors` (`accent`), anything else a constant of `Tokens` (`spaceMd`). */
export const dartName = (t: Pick<Token, "path" | "type">): string => camel(t.type === "color" ? t.path.slice(1) : t.path);

/** The same order everywhere, whatever order the file or the JSON parser gives: by path, one segment at a time. */
function byPath(a: Token, b: Token): number {
  const n = Math.min(a.path.length, b.path.length);
  for (let i = 0; i < n; i++) {
    if (a.path[i] !== b.path[i]) return (a.path[i] as string) < (b.path[i] as string) ? -1 : 1;
  }
  return a.path.length - b.path.length;
}

/** Validate a tokens file and flatten it into tokens in the canonical order. Problems are readable sentences naming the token. */
export function readTokens(tree: unknown): { tokens: Token[]; problems: string[] } {
  const tokens: Token[] = [];
  const problems: string[] = [];
  if (!isObject(tree)) return { tokens, problems: ["the file must hold one JSON object"] };

  const walk = (node: unknown, path: string[], inherited: unknown): void => {
    const here = path.join(".");
    if (!isObject(node)) {
      problems.push(`${here}: expected a group or a token`);
      return;
    }
    const kind = node.$type ?? inherited;
    if ("$value" in node) {
      if (Object.keys(node).some((k) => !k.startsWith("$"))) {
        problems.push(`${here}: a token cannot also hold other tokens`);
        return;
      }
      if (!(TOKEN_TYPES as readonly unknown[]).includes(kind)) {
        problems.push(`${here}: needs a $type of ${TOKEN_TYPES.join(", ")}`);
        return;
      }
      const type = kind as TokenType;
      const v = value(type, node.$value, here, problems);
      let dark: string | null = null;
      const ext = isObject(node.$extensions) && isObject(node.$extensions.scaffolder) ? node.$extensions.scaffolder : {};
      if ("dark" in ext) {
        if (type !== "color") problems.push(`${here}: only a colour has a dark value`);
        else dark = value("color", ext.dark, `${here} (dark)`, problems);
      }
      if (v !== null) tokens.push({ path, type, value: v, dark });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (!NAME.test(key)) {
        problems.push(`${here ? `${here}.` : ""}${key}: names use lowercase letters, digits and dashes`);
        continue;
      }
      walk(child, [...path, key], kind);
    }
  };
  walk(tree, [], undefined);

  tokens.sort(byPath);
  const css = new Map<string, string>();
  const dart = new Map<string, string>();
  for (const t of tokens) {
    const here = t.path.join(".");
    const c = cssName(t.path);
    if (css.has(c)) problems.push(`${here}: becomes ${c}, which ${css.get(c)} already is`);
    css.set(c, here);
    // A Dart name only matters for what the Dart generator emits (em values and font families stay on the web).
    if (inDart(t)) {
      const d = `${t.type === "color" ? "color:" : ""}${dartName(t)}`;
      if (dart.has(d)) problems.push(`${here}: becomes the Dart name ${dartName(t)}, which ${dart.get(d)} already is`);
      dart.set(d, here);
      if (t.type === "color" && DART_RESERVED.has(dartName(t))) problems.push(`${here}: ${dartName(t)} is a Dart reserved word`);
    }
  }
  for (const name of REQUIRED_COLORS) {
    if (!tokens.some((t) => t.type === "color" && t.path.join(".") === `color.${name}`)) problems.push(`color.${name}: required (the themes use it)`);
  }
  return { tokens, problems };
}

export const CSS_HEADER = "/* GENERATED from .ai/design/tokens.json by `./scripts/sdlc design sync`. Do not edit: change the tokens, then sync. */";

export function renderCss(tokens: Token[]): string {
  const lines = [CSS_HEADER, ":root {", ...tokens.map((t) => `  ${cssName(t.path)}: ${t.value};`), "}"];
  const dark = tokens.filter((t) => t.dark !== null && t.dark !== t.value);
  if (dark.length > 0) {
    lines.push("", "@media (prefers-color-scheme: dark) {", "  :root {", ...dark.map((t) => `    ${cssName(t.path)}: ${t.dark};`), "  }", "}");
  }
  return lines.join("\n") + "\n";
}

/** `amount` times `factor`, written as a short decimal, with integer arithmetic so every language prints the same digits. */
export function scaled(amount: string, factor: number): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!m) throw new Error(`not a number: ${amount}`);
  const sign = m[1] as string;
  const frac = m[3] ?? "";
  let digits = String(Number(`${m[2]}${frac}`) * factor);
  digits = digits.padStart(frac.length + 1, "0");
  const whole = frac ? digits.slice(0, -frac.length) : digits;
  const rest = frac ? digits.slice(-frac.length).replace(/0+$/, "") : "";
  const out = `${whole}${rest ? `.${rest}` : ""}`;
  return out === "0" ? "0" : `${sign}${out}`;
}

function dartDimension(v: string): string {
  const m = DIMENSION.exec(v) as RegExpExecArray;
  return scaled(m[1] as string, m[2] === "rem" ? 16 : 1);
}

function dartColour(hex: string): string {
  const h = hex.slice(1).toUpperCase();
  return `0x${h.length === 6 ? "FF" : h.slice(6)}${h.slice(0, 6)}`;
}

export const DART_HEADER = [
  "// GENERATED from .ai/design/tokens.json by `./scripts/sdlc design sync`.",
  "// Do not edit: change the tokens, then sync. Not formatted on purpose (the formatter skips what is between the markers).",
  "// dart format off",
].join("\n");

/** Flutter gets colours (per theme), spacing, radius, type sizes and weights. Font families and em values are web-only. */
export function renderDart(tokens: Token[]): string {
  const colours = tokens.filter((t) => t.type === "color");
  const numbers = tokens.filter((t) => t.type === "dimension" && inDart(t));
  const weights = tokens.filter((t) => t.type === "fontWeight");
  const set = (name: string, pick: (t: Token) => string) => [
    `  static const TokenColors ${name} = TokenColors(`,
    ...colours.map((t) => `    ${dartName(t)}: Color(${dartColour(pick(t))}),`),
    "  );",
  ];
  const lines = [
    DART_HEADER,
    "import 'dart:ui' show Color, FontWeight;",
    "",
    "/// The colours of one theme.",
    "class TokenColors {",
    "  const TokenColors({",
    ...colours.map((t) => `    required this.${dartName(t)},`),
    "  });",
    "",
    ...colours.map((t) => `  final Color ${dartName(t)};`),
    "}",
    "",
    "/// Every design token the app can use, by name.",
    "abstract final class Tokens {",
    ...set("light", (t) => t.value),
    "",
    ...set("dark", (t) => t.dark ?? t.value),
    ...(numbers.length > 0 ? [""] : []),
    ...numbers.map((t) => `  static const double ${dartName(t)} = ${dartDimension(t.value)};`),
    ...(weights.length > 0 ? [""] : []),
    ...weights.map((t) => `  static const FontWeight ${dartName(t)} = FontWeight.w${t.value};`),
    "}",
    "// dart format on",
  ];
  return lines.join("\n") + "\n";
}

export interface DesignOutput {
  target: "css" | "dart";
  path: string;
}

export interface DesignScan {
  /** Folder (repo-relative) whose files are checked for hard-coded design values. */
  root: string;
  kind: "web" | "dart";
  extensions: string[];
}

export interface DesignPlan {
  tokens: string;
  outputs: DesignOutput[];
  scan: DesignScan[];
}

/** Where the tokens go and what is checked, for this project's components. Null when the project has no screen. */
export function designPlan(cfg: ScaffolderConfig): DesignPlan | null {
  if (!cfg.web.enabled && !cfg.mobile.enabled) return null;
  const outputs: DesignOutput[] = [];
  const scan: DesignScan[] = [];
  if (cfg.web.enabled) {
    const web = webStack(cfg);
    outputs.push({ target: "css", path: `${cfg.layout.webDir}/${web.design.tokensCss}` });
    scan.push({ root: `${cfg.layout.webDir}/${web.design.sourceDir}`, kind: "web", extensions: [".css", ".ts", ".tsx", ".js", ".jsx", ".vue"] });
  }
  if (cfg.mobile.enabled) {
    const mobile = mobileStack(cfg);
    outputs.push({ target: "dart", path: `${cfg.layout.mobileDir}/${mobile.design.tokensFile}` });
    scan.push({ root: `${cfg.layout.mobileDir}/${mobile.design.sourceDir}`, kind: "dart", extensions: [".dart"] });
  }
  return { tokens: TOKENS_PATH, outputs, scan };
}

/** The tokens file and everything generated from it, as the project starts out. Empty when the project has no screen. */
export function designFiles(cfg: ScaffolderConfig): Array<{ path: string; content: string }> {
  const plan = designPlan(cfg);
  if (!plan) return [];
  const { tokens, problems } = readTokens(JSON.parse(tokensFile()));
  if (problems.length > 0) throw new Error(`the default design tokens are invalid: ${problems.join("; ")}`);
  return [
    { path: plan.tokens, content: tokensFile() },
    ...plan.outputs.map((o) => ({ path: o.path, content: o.target === "css" ? renderCss(tokens) : renderDart(tokens) })),
  ];
}
