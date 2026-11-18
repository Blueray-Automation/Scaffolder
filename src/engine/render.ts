import Mustache from "mustache";

/**
 * Templates use `<% %>` delimiters (not `{{ }}`) so that GitHub Actions
 * `${{ }}` expressions, bash `[[ ]]` tests and the runtime `{{prompt}}`
 * placeholders used by the generated loop tool pass through untouched.
 */
const TAGS: [string, string] = ["<%", "%>"];

type Token = [string, string, number, number, Token[]?, number?];

type View = Record<string, unknown>;

interface Lookup {
  found: boolean;
  value: unknown;
}

function lookup(stack: unknown[], name: string): Lookup {
  if (name === ".") return { found: true, value: stack[stack.length - 1] };
  const [head, ...rest] = name.split(".");
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame !== null && typeof frame === "object" && head in (frame as object)) {
      let value: unknown = (frame as View)[head];
      for (const part of rest) {
        if (value === null || typeof value !== "object" || !(part in (value as object))) {
          return { found: false, value: undefined };
        }
        value = (value as View)[part];
      }
      return { found: true, value };
    }
  }
  return { found: false, value: undefined };
}

function collectMissing(tokens: Token[], stack: unknown[], missing: Set<string>): void {
  for (const token of tokens) {
    const [type, name] = token;
    if (type === "name" || type === "&" || type === "{") {
      if (!lookup(stack, name).found) missing.add(name);
    } else if (type === "#" || type === "^") {
      const res = lookup(stack, name);
      if (!res.found) {
        missing.add(name);
        continue;
      }
      const children = token[4] ?? [];
      if (type === "#" && Array.isArray(res.value)) {
        for (const item of res.value) collectMissing(children, [...stack, item], missing);
      } else if (type === "#" && res.value !== null && typeof res.value === "object") {
        collectMissing(children, [...stack, res.value], missing);
      } else {
        collectMissing(children, stack, missing);
      }
    }
  }
}

/** Names referenced by a template that the view does not define. */
export function findMissingVariables(template: string, view: View): string[] {
  const tokens = Mustache.parse(template, TAGS) as unknown as Token[];
  const missing = new Set<string>();
  collectMissing(tokens, [view], missing);
  return [...missing].sort();
}

export class TemplateError extends Error {
  constructor(public readonly file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "TemplateError";
  }
}

/**
 * Render a template. Unlike stock Mustache, a variable that the view does not
 * define is an error (typos must not silently render as empty strings).
 */
export function renderTemplate(template: string, view: View, file = "<template>"): string {
  let missing: string[];
  try {
    missing = findMissingVariables(template, view);
  } catch (e) {
    throw new TemplateError(file, (e as Error).message);
  }
  if (missing.length > 0) {
    throw new TemplateError(file, `undefined template variable(s): ${missing.join(", ")}`);
  }
  return Mustache.render(template, view, {}, { tags: TAGS, escape: (s: string) => s });
}
