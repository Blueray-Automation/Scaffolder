import type { MobileFramework, ScaffolderConfig } from "./config";

/**
 * What differs between the mobile frameworks that have a pack, in one place: the commands the gates run, the setup
 * step that installs dependencies, the environment the tools need and the words the generated docs use. Mirrors
 * `webStacks.ts`: the rest of the engine asks this module instead of checking for a framework by name.
 */
export interface MobileStack {
  /** "Flutter" */
  name: string;
  /** "Flutter (Dart)": how README and AGENTS describe the app. */
  description: string;
  /** The SDK program every gate runs: `doctor` looks for it. */
  tool: string;
  /** The file in `.ai/rules/` that holds this stack's conventions. */
  ruleFile: string;
  /** Static analysis (format + lints + types in one pass: Dart's analyzer is also its type checker). */
  analyze: { label: string; cmd: string };
  /** Unit and widget tests, with the coverage floor enforced by the command itself. */
  unit: (floor: number) => { label: string; cmd: string };
  /** A compile that needs nothing but the SDK, so it runs the same on every machine and in CI. */
  build: { label: string; cmd: string };
  /** Dependency install: `cmd` when a lockfile is committed, `fallbackCmd` before the first one exists. */
  install: { cmd: string; fallbackCmd: string; lockfile: string; manifest: string; marker: string; label: string };
  /** Set for every gate (and the facts that run the tests). */
  env: Record<string, string>;
  /** The language SDK each framework release line ships with: `pubspec.yaml` constrains both. */
  languageSdk: Record<string, string>;
  /** Why this project name cannot be the app's package name (the name comes from the project's), or undefined when it can. */
  projectNameProblem: (slug: string) => string | undefined;
}

/**
 * Words `dart pub get` refuses as a package name, found by trying each Dart keyword with Dart 3.14 (`abstract` and `import`
 * are refused; `typedef` and `dynamic` are not), plus the three that YAML reads as something other than a string.
 */
const DART_UNUSABLE_NAMES = new Set(
  (
    "abstract as assert await break case catch class const continue covariant default deferred do else enum export extends " +
    "external final finally for hide if implements import in interface is late library mixin new of on operator part " +
    "required rethrow return sealed set super switch this throw try type var void while with yield null true false"
  ).split(" "),
);

/**
 * Every package in the generated app's resolved dependency graph (read from a `pubspec.lock`, with and without `http`).
 * A package cannot depend on itself, so a project with one of these names fails `pub get`.
 */
const DART_DEPENDENCY_NAMES = new Set(
  (
    "async boolean_selector characters clock collection cupertino_ui fake_async flutter flutter_lints flutter_localizations " +
    "flutter_test http http_parser intl leak_tracker leak_tracker_flutter_testing leak_tracker_testing lints listen matcher " +
    "material_color_utilities material_ui meta path sky_engine source_span stack_trace stream_channel string_scanner " +
    "term_glyph test_api typed_data vector_math vm_service web"
  ).split(" "),
);

const FLUTTER: MobileStack = {
  name: "Flutter",
  description: "Flutter (Dart)",
  tool: "flutter",
  ruleFile: "mobile-flutter.md",
  analyze: {
    label: "Mobile analysis & format (flutter analyze, dart format)",
    // Analysis first: `flutter analyze` installs the dependencies itself, so by the time the formatter runs it can resolve
    // analysis_options.yaml (before that it prints a warning per file). Both run at Dart's default width, no flags needed.
    cmd: "flutter analyze --fatal-infos && dart format --output=none --set-exit-if-changed .",
  },
  unit: (floor) => ({
    label: `Mobile unit & widget tests (flutter test, coverage >= ${floor}%)`,
    cmd: `flutter test --coverage && dart run tool/check_coverage.dart --min ${floor}`,
  }),
  build: { label: "Mobile build check (flutter build bundle)", cmd: "flutter build bundle" },
  install: {
    label: "Install mobile dependencies (flutter pub get)",
    cmd: "flutter pub get --enforce-lockfile",
    fallbackCmd: "flutter pub get",
    lockfile: "pubspec.lock",
    manifest: "pubspec.yaml",
    marker: ".dart_tool",
  },
  // Automated runs report no usage statistics (like NEXT_TELEMETRY_DISABLED); a person's own flutter settings are left alone.
  env: { FLUTTER_SUPPRESS_ANALYTICS: "true" },
  // The Flutter stable lines offered, and the Dart each bundles (https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json).
  // Only 3.50 was run against: 3.47 (Dart 3.13) is not offered, because the formatter's output can differ between Dart releases and the
  // templates are formatted by Dart 3.14. Add a line here only after running the gates and `npm run e2e -- --scenario flutter-only` on it.
  languageSdk: { "3.50": "3.14" },
  projectNameProblem: (slug) => {
    const name = slug.replace(/-/g, "_");
    if (DART_UNUSABLE_NAMES.has(name)) return `"${name}" is a Dart reserved word, so it cannot be the name of the app's package.`;
    if (DART_DEPENDENCY_NAMES.has(name)) return `"${name}" is the name of a package the app depends on, and a package cannot depend on itself.`;
    return undefined;
  },
};

const STACKS: Partial<Record<MobileFramework, MobileStack>> = { flutter: FLUTTER };

/**
 * The stack of the configured mobile framework. A framework without a pack never gets this far (validation rejects it
 * before anything is generated), so the fallback only keeps callers that skip validation from crashing.
 */
export function mobileStack(cfg: ScaffolderConfig): MobileStack {
  return STACKS[cfg.mobile.framework] ?? FLUTTER;
}
