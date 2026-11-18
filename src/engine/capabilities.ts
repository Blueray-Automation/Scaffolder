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
      { id: "nuxt", label: "Nuxt", available: false, versions: ["24", "22"] },
    ] as VersionedOption[],
  },
  mobile: {
    frameworks: [
      { id: "flutter", label: "Flutter", available: false },
      { id: "react-native", label: "React Native", available: false },
    ] as Option[],
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

export function findOption<T extends Option>(list: readonly T[], id: string): T | undefined {
  return list.find((o) => o.id === id);
}

export function availableIds(list: readonly Option[]): string[] {
  return list.filter((o) => o.available).map((o) => o.id);
}
