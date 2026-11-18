export type ArchitectureType =
  | "microservice"
  | "fullstack"
  | "fullstack-mobile"
  | "monolith";

export type BackendLang = "python" | "java" | "node" | "go";

export type FrontendFramework = "vue" | "nextjs" | "nuxt" | "react";

export type MobileFramework = "flutter" | "react-native";

export type DatabaseType = "postgres" | "mysql" | "mongodb" | "sqlite";

export type CacheType = "redis" | "none";

export type AuthType = "jwt" | "keycloak" | "session" | "none";

export type CiProvider = "github-actions" | "gitlab-ci" | "none";

export interface ScaffolderConfig {
  projectName: string;
  architecture: ArchitectureType;
  includeBackend: boolean;
  backendLang: BackendLang;
  backendFramework: string;
  backendVersion: string;
  database: DatabaseType;
  cache: CacheType;
  auth: AuthType;
  includeWeb: boolean;
  webFramework: FrontendFramework;
  webTypescript: boolean;
  includeMobile: boolean;
  mobileFramework: MobileFramework;
  mobileStateMgmt: string;
  includeDocker: boolean;
  ciProvider: CiProvider;
  maxHealingLoops: number;
}
