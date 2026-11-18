import { ScaffolderConfig } from "./types";

export function sanitizeName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "my-ai-project";
}

export function generateDirectoryTree(cfg: ScaffolderConfig): string {
  const root = sanitizeName(cfg.projectName);
  const lines: string[] = [`${root}/`];

  // .ai directory
  lines.push("├── .ai/");
  lines.push("│   ├── rules/");
  lines.push("│   │   ├── prd-schema.md");
  lines.push("│   │   ├── api-contract.md");
  if (cfg.includeBackend) {
    lines.push(`│   │   ├── backend-${cfg.backendLang}.md`);
  }
  if (cfg.includeWeb) {
    lines.push(`│   │   ├── web-${cfg.webFramework}.md`);
  }
  if (cfg.includeMobile) {
    lines.push(`│   │   └── mobile-${cfg.mobileFramework}.md`);
  }
  lines.push("│   ├── specs/");
  lines.push("│   │   └── .gitkeep");
  lines.push("│   └── logs/");
  lines.push("│       └── .gitkeep");

  const isMonolith = cfg.architecture === "monolith";

  // Backend
  if (cfg.includeBackend) {
    const bPrefix = isMonolith ? "├── src/server/" : "├── backend/";
    lines.push(bPrefix);
    if (cfg.backendLang === "python") {
      lines.push("│   ├── app/");
      lines.push("│   │   ├── main.py");
      lines.push("│   │   ├── core/ (config.py, security.py, logging.py)");
      lines.push("│   │   ├── api/v1/ (routes.py, health.py)");
      lines.push("│   │   ├── schemas/ (Pydantic v2 contracts)");
      lines.push("│   │   ├── models/ (SQLAlchemy async ORM)");
      lines.push("│   │   └── repositories/");
      lines.push("│   ├── tests/ (conftest.py, test_health.py)");
      if (cfg.includeDocker) lines.push("│   ├── Dockerfile");
      lines.push("│   └── pyproject.toml");
    } else if (cfg.backendLang === "java") {
      lines.push("│   ├── src/main/java/com/app/");
      lines.push("│   │   ├── Application.java");
      lines.push("│   │   ├── config/");
      lines.push("│   │   ├── controller/");
      lines.push("│   │   ├── dto/");
      lines.push("│   │   ├── service/");
      lines.push("│   │   └── repository/");
      lines.push("│   ├── src/test/java/com/app/");
      if (cfg.includeDocker) lines.push("│   ├── Dockerfile");
      lines.push("│   └── pom.xml");
    } else if (cfg.backendLang === "node") {
      lines.push("│   ├── src/");
      lines.push("│   │   ├── main.ts");
      lines.push("│   │   ├── modules/");
      lines.push("│   │   └── common/");
      lines.push("│   ├── test/");
      if (cfg.includeDocker) lines.push("│   ├── Dockerfile");
      lines.push("│   └── package.json");
    } else {
      lines.push("│   ├── cmd/server/main.go");
      lines.push("│   ├── internal/ (handler/, service/, repo/)");
      if (cfg.includeDocker) lines.push("│   ├── Dockerfile");
      lines.push("│   └── go.mod");
    }
  }

  // Web Frontend
  if (cfg.includeWeb) {
    const wPrefix = isMonolith ? "├── src/client/" : "├── web/";
    const ext = cfg.webTypescript ? "ts" : "js";
    lines.push(wPrefix);
    if (cfg.webFramework === "vue") {
      lines.push("│   ├── src/");
      lines.push(`│   │   ├── main.${ext}`);
      lines.push("│   │   ├── stores/ (Pinia state slices)");
      lines.push("│   │   ├── services/ (Axios API client)");
      lines.push("│   │   ├── components/");
      lines.push("│   │   └── views/");
      lines.push("│   ├── tests/ (Vitest specs)");
    } else if (cfg.webFramework === "nextjs") {
      lines.push("│   ├── src/app/ (App Router layouts & pages)");
      lines.push("│   ├── src/components/");
      lines.push("│   ├── src/lib/ (Typed API fetcher)");
      lines.push("│   └── __tests__/");
    } else if (cfg.webFramework === "nuxt") {
      lines.push("│   ├── pages/");
      lines.push("│   ├── composables/");
      lines.push("│   ├── stores/");
      lines.push("│   └── server/api/");
    } else {
      lines.push("│   ├── src/");
      lines.push(`│   │   ├── main.${ext}x`);
      lines.push("│   │   ├── hooks/");
      lines.push("│   │   ├── services/");
      lines.push("│   │   └── components/");
      lines.push("│   └── tests/");
    }
    if (cfg.includeDocker) lines.push("│   ├── Dockerfile");
    lines.push("│   └── package.json");
  }

  // Mobile
  if (cfg.includeMobile) {
    lines.push("├── mobile/");
    if (cfg.mobileFramework === "flutter") {
      lines.push("│   ├── lib/");
      lines.push("│   │   ├── main.dart");
      lines.push("│   │   ├── core/ (network/dio_client.dart, error/)");
      lines.push("│   │   ├── data/ (models/, datasources/, repositories/)");
      lines.push("│   │   ├── domain/ (entities/, usecases/)");
      lines.push(`│   │   └── presentation/ (${cfg.mobileStateMgmt.toLowerCase()}/, screens/, widgets/)`);
      lines.push("│   ├── test/");
      lines.push("│   └── pubspec.yaml");
    } else {
      lines.push("│   ├── src/ (screens/, navigation/, store/, api/)");
      lines.push("│   ├── __tests__/");
      lines.push("│   └── package.json");
    }
  }

  // Scripts
  lines.push("├── scripts/");
  lines.push("│   ├── feature-runner.sh");
  lines.push("│   └── loop-runner.sh");

  // CI/CD
  if (cfg.ciProvider === "github-actions") {
    lines.push("├── .github/");
    lines.push("│   └── workflows/");
    lines.push("│       └── ci.yml");
  } else if (cfg.ciProvider === "gitlab-ci") {
    lines.push("├── .gitlab-ci.yml");
  }

  // Root files
  if (cfg.includeDocker) {
    lines.push("├── docker-compose.yml");
  }
  lines.push("├── .env.example");
  lines.push("└── README.md");

  return lines.join("\n");
}

export function generateInitScript(cfg: ScaffolderConfig): string {
  const root = sanitizeName(cfg.projectName);
  const isMonolith = cfg.architecture === "monolith";
  const backendDir = isMonolith ? "src/server" : "backend";
  const webDir = isMonolith ? "src/client" : "web";

  let script = `#!/usr/bin/env bash
# ==============================================================================
# init-project.sh
# Generated by AI SDLC Scaffolder
# Project: ${root} | Topology: ${cfg.architecture}
# ==============================================================================
set -euo pipefail

PROJECT_NAME="${root}"
echo "==> Initializing AI SDLC Workspace: $PROJECT_NAME"

mkdir -p "$PROJECT_NAME"
cd "$PROJECT_NAME"
git init -q

# 1. Create AI SDLC Governance & Spec Directories
mkdir -p .ai/rules .ai/specs .ai/logs scripts
touch .ai/specs/.gitkeep .ai/logs/.gitkeep

cat << 'EOF' > .ai/rules/prd-schema.md
# Phase 1: PRD Specification Rules
Every feature must be written to .ai/specs/FEAT-XXX-prd.md before coding:
1. Feature Identifier & Objective (1-2 sentences)
2. User Stories & Acceptance Criteria (Given-When-Then, including edge/empty states)
3. Permissions & Roles
4. Data Fields, Types & Validation Constraints
5. Out of Scope
EOF

cat << 'EOF' > .ai/rules/api-contract.md
# Phase 2: API Contract Rules
Backend serves as single source of truth. Define before client code:
1. Request/Response schemas with strict types and field boundaries
2. Endpoint paths, HTTP methods, status codes, and error payloads (400/401/403/404/422)
3. Database migration & index impacts
4. Client state mappings & Error Matrix
EOF
`;

  if (cfg.includeBackend) {
    script += `
# 2. Scaffold Backend (${cfg.backendLang} ${cfg.backendVersion} - ${cfg.backendFramework})
mkdir -p "${backendDir}"
cat << 'EOF' > .ai/rules/backend-${cfg.backendLang}.md
# Backend Coding Standards (${cfg.backendLang} ${cfg.backendVersion} / ${cfg.backendFramework})
- Enforce strict static typing and input schema validation at boundary.
- Keep route handlers thin; isolate DB/ORM queries inside repository/service layers.
- Never hardcode secrets; load via environment config.
- Every endpoint requires automated unit/integration tests with mocked external calls.
EOF
`;

    if (cfg.backendLang === "python") {
      script += `mkdir -p "${backendDir}/app/core" "${backendDir}/app/api/v1" "${backendDir}/app/schemas" "${backendDir}/app/models" "${backendDir}/app/repositories" "${backendDir}/tests"

cat << 'EOF' > "${backendDir}/pyproject.toml"
[project]
name = "${root}-backend"
version = "0.1.0"
requires-python = ">=${cfg.backendVersion}"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.6.0",
    "sqlalchemy[asyncio]>=2.0.35",
    "asyncpg>=0.30.0",
    "httpx>=0.27.2",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3.3",
    "pytest-asyncio>=0.24.0",
    "ruff>=0.7.0",
]

[tool.ruff]
line-length = 100
target-version = "py${cfg.backendVersion.replace(".", "")}"
EOF

cat << 'EOF' > "${backendDir}/app/main.py"
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="${root} API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", tags=["System"])
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "${root}-backend"}
EOF

cat << 'EOF' > "${backendDir}/tests/test_health.py"
import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_health_endpoint() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
EOF
`;
      if (cfg.includeDocker) {
        script += `cat << 'EOF' > "${backendDir}/Dockerfile"
FROM python:${cfg.backendVersion}-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml .
RUN pip install --no-cache-dir .
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
EOF
`;
      }
    } else if (cfg.backendLang === "java") {
      script += `mkdir -p "${backendDir}/src/main/java/com/app/controller" "${backendDir}/src/main/java/com/app/service" "${backendDir}/src/main/java/com/app/dto" "${backendDir}/src/test/java/com/app"

cat << 'EOF' > "${backendDir}/pom.xml"
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
  </parent>
  <groupId>com.app</groupId>
  <artifactId>${root}-backend</artifactId>
  <version>0.1.0</version>
  <properties>
    <java.version>${cfg.backendVersion}</java.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
EOF
`;
      if (cfg.includeDocker) {
        script += `cat << 'EOF' > "${backendDir}/Dockerfile"
FROM eclipse-temurin:${cfg.backendVersion}-jdk-alpine AS build
WORKDIR /app
COPY . .
RUN ./mvnw clean package -DskipTests || mvn clean package -DskipTests

FROM eclipse-temurin:${cfg.backendVersion}-jre-alpine
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
EOF
`;
      }
    } else if (cfg.backendLang === "node") {
      script += `mkdir -p "${backendDir}/src/modules" "${backendDir}/test"
cat << 'EOF' > "${backendDir}/package.json"
{
  "name": "${root}-backend",
  "version": "0.1.0",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js",
    "test": "vitest run"
  }
}
EOF
`;
    } else {
      script += `mkdir -p "${backendDir}/cmd/server" "${backendDir}/internal/handler"
cat << 'EOF' > "${backendDir}/go.mod"
module github.com/org/${root}-backend

go ${cfg.backendVersion}
EOF
`;
    }
  }

  if (cfg.includeWeb) {
    const langMode = cfg.webTypescript ? "TypeScript (strict mode, no any)" : "JavaScript (ES2023+)";
    script += `
# 3. Scaffold Web Frontend (${cfg.webFramework} - ${langMode})
mkdir -p "${webDir}/src"
cat << 'EOF' > .ai/rules/web-${cfg.webFramework}.md
# Web Frontend Coding Standards (${cfg.webFramework} / ${langMode})
- Enforce ${langMode}.
- Isolate all network requests inside typed service clients matching Phase 2 API contracts.
- Explicitly represent loading, empty, error, and success UI states.
- Validate user input client-side before network dispatch.
- Include unit tests for state transitions and error boundaries.
EOF

cat << 'EOF' > "${webDir}/package.json"
{
  "name": "${root}-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "${cfg.webFramework === "nextjs" ? "next dev" : cfg.webFramework === "nuxt" ? "nuxt dev" : "vite"}",
    "build": "${cfg.webFramework === "nextjs" ? "next build" : cfg.webFramework === "nuxt" ? "nuxt build" : "vite build"}",
    "type-check": "${cfg.webTypescript ? "tsc --noEmit" : "echo 'JS mode'"}",
    "test:unit": "vitest run"
  }
}
EOF
`;
  }

  if (cfg.includeMobile) {
    script += `
# 4. Scaffold Mobile App (${cfg.mobileFramework} - ${cfg.mobileStateMgmt})
mkdir -p mobile/lib/core mobile/lib/data mobile/lib/domain mobile/lib/presentation mobile/test
cat << 'EOF' > .ai/rules/mobile-${cfg.mobileFramework}.md
# Mobile Coding Standards (${cfg.mobileFramework} / ${cfg.mobileStateMgmt})
- Follow Clean Architecture: Data -> Domain/Repository -> Presentation.
- Enforce ${cfg.mobileStateMgmt} state management with explicit Initial, Loading, Success, Failure states.
- Handle offline/timeout network errors gracefully with retry affordances.
- Include unit tests for state transitions and widget smoke tests.
EOF
`;
  }

  // Write loop-runner.sh
  script += `
# 5. Write Automated Loop Verification Runner (scripts/loop-runner.sh)
cat << 'EOF' > scripts/loop-runner.sh
#!/usr/bin/env bash
set -uo pipefail

TARGET="\${1:-all}"
ERROR_LOG=".ai/logs/loop_failure.log"
mkdir -p .ai/logs
: > "$ERROR_LOG"

run_backend() {
  echo "==> [Backend] Running linters & tests..."
  (
    cd "${backendDir}"
`;
  if (cfg.backendLang === "python") {
    script += `    ruff check . >> "../../$ERROR_LOG" 2>&1 && pytest --maxfail=1 -q >> "../../$ERROR_LOG" 2>&1
`;
  } else if (cfg.backendLang === "java") {
    script += `    mvn test -B >> "../../$ERROR_LOG" 2>&1
`;
  } else {
    script += `    npm test >> "../../$ERROR_LOG" 2>&1
`;
  }
  script += `  )
}

run_web() {
  echo "==> [Web] Running type-check & unit tests..."
  (
    cd "${webDir}"
    npm run type-check >> "../../$ERROR_LOG" 2>&1 && npm run test:unit >> "../../$ERROR_LOG" 2>&1
  )
}

run_mobile() {
  echo "==> [Mobile] Running analyzer & widget tests..."
  (
    cd mobile
    flutter analyze >> "../$ERROR_LOG" 2>&1 && flutter test >> "../$ERROR_LOG" 2>&1
  )
}

case "$TARGET" in
  backend) run_backend || exit 1 ;;
  web)     run_web || exit 1 ;;
  mobile)  run_mobile || exit 1 ;;
  all)
    ${cfg.includeBackend ? "run_backend || exit 1" : ""}
    ${cfg.includeWeb ? "run_web || exit 1" : ""}
    ${cfg.includeMobile ? "run_mobile || exit 1" : ""}
    ;;
  *)
    echo "Usage: $0 [backend|web|mobile|all]"
    exit 1
    ;;
esac

echo "[PASS] All verification gates succeeded."
rm -f "$ERROR_LOG"
EOF
chmod +x scripts/loop-runner.sh
`;

  if (cfg.includeDocker) {
    script += `
# 6. Write Docker Compose Orchestration
cat << 'EOF' > docker-compose.yml
${generateDockerCompose(cfg)}
EOF
`;
  }

  if (cfg.ciProvider === "github-actions") {
    script += `
# 7. Write GitHub Actions CI Pipeline
mkdir -p .github/workflows
cat << 'EOF' > .github/workflows/ci.yml
${generateCiYaml(cfg)}
EOF
`;
  }

  script += `
# 8. Write Feature Execution Runner
cat << 'EOF' > scripts/feature-runner.sh
${generateFeatureRunner(cfg)}
EOF
chmod +x scripts/feature-runner.sh

echo ""
echo "✅ Scaffold complete! Next steps:"
echo "   cd $PROJECT_NAME"
echo "   ./scripts/feature-runner.sh --feature \"User-Authentication\""
`;

  return script;
}

export function generateDockerCompose(cfg: ScaffolderConfig): string {
  const root = sanitizeName(cfg.projectName);
  const isMonolith = cfg.architecture === "monolith";
  const backendDir = isMonolith ? "./src/server" : "./backend";
  const webDir = isMonolith ? "./src/client" : "./web";

  const lines: string[] = ["services:"];

  if (cfg.includeBackend) {
    const port = cfg.backendLang === "python" ? "8000" : cfg.backendLang === "java" ? "8080" : "3001";
    lines.push("  backend:");
    lines.push(`    build: ${backendDir}`);
    lines.push(`    container_name: ${root}-backend`);
    lines.push("    ports:");
    lines.push(`      - "${port}:${port}"`);
    lines.push("    env_file:");
    lines.push("      - .env");
    if (cfg.database !== "sqlite" || cfg.cache === "redis") {
      lines.push("    depends_on:");
      if (cfg.database !== "sqlite") lines.push(`      - ${cfg.database}`);
      if (cfg.cache === "redis") lines.push("      - redis");
    }
    lines.push("");
  }

  if (cfg.includeWeb) {
    const webPort = cfg.webFramework === "nextjs" || cfg.webFramework === "nuxt" ? "3000" : "5173";
    lines.push("  web:");
    lines.push(`    build: ${webDir}`);
    lines.push(`    container_name: ${root}-web`);
    lines.push("    ports:");
    lines.push(`      - "${webPort}:${webPort}"`);
    lines.push("    environment:");
    lines.push(`      - NEXT_PUBLIC_API_URL=http://localhost:${cfg.backendLang === "java" ? "8080" : "8000"}`);
    if (cfg.includeBackend) {
      lines.push("    depends_on:");
      lines.push("      - backend");
    }
    lines.push("");
  }

  if (cfg.database === "postgres") {
    lines.push("  postgres:");
    lines.push("    image: postgres:16-alpine");
    lines.push(`    container_name: ${root}-postgres`);
    lines.push("    environment:");
    lines.push("      POSTGRES_USER: app_user");
    lines.push("      POSTGRES_PASSWORD: app_password");
    lines.push(`      POSTGRES_DB: ${root.replace(/-/g, "_")}`);
    lines.push("    ports:");
    lines.push('      - "5432:5432"');
    lines.push("    volumes:");
    lines.push("      - pg_data:/var/lib/postgresql/data");
    lines.push("");
  } else if (cfg.database === "mysql") {
    lines.push("  mysql:");
    lines.push("    image: mysql:8.4");
    lines.push(`    container_name: ${root}-mysql`);
    lines.push("    environment:");
    lines.push("      MYSQL_ROOT_PASSWORD: root_password");
    lines.push(`      MYSQL_DATABASE: ${root.replace(/-/g, "_")}`);
    lines.push("    ports:");
    lines.push('      - "3306:3306"');
    lines.push("    volumes:");
    lines.push("      - mysql_data:/var/lib/mysql");
    lines.push("");
  } else if (cfg.database === "mongodb") {
    lines.push("  mongodb:");
    lines.push("    image: mongo:7");
    lines.push(`    container_name: ${root}-mongo`);
    lines.push("    ports:");
    lines.push('      - "27017:27017"');
    lines.push("    volumes:");
    lines.push("      - mongo_data:/data/db");
    lines.push("");
  }

  if (cfg.cache === "redis") {
    lines.push("  redis:");
    lines.push("    image: redis:7-alpine");
    lines.push(`    container_name: ${root}-redis`);
    lines.push("    ports:");
    lines.push('      - "6379:6379"');
    lines.push("");
  }

  const volumes: string[] = [];
  if (cfg.database === "postgres") volumes.push("  pg_data:");
  if (cfg.database === "mysql") volumes.push("  mysql_data:");
  if (cfg.database === "mongodb") volumes.push("  mongo_data:");

  if (volumes.length > 0) {
    lines.push("volumes:");
    lines.push(...volumes);
  }

  return lines.join("\n");
}

export function generateCiYaml(cfg: ScaffolderConfig): string {
  const isMonolith = cfg.architecture === "monolith";
  const backendDir = isMonolith ? "src/server" : "backend";
  const webDir = isMonolith ? "src/client" : "web";

  const lines: string[] = [
    "name: AI SDLC Verification Pipeline",
    "",
    "on:",
    "  push:",
    "    branches: [main, develop]",
    "  pull_request:",
    "    branches: [main]",
    "",
    "jobs:",
  ];

  if (cfg.includeBackend) {
    lines.push("  backend-verify:");
    lines.push("    runs-on: ubuntu-latest");
    lines.push("    defaults:");
    lines.push("      run:");
    lines.push(`        working-directory: ${backendDir}`);
    lines.push("    steps:");
    lines.push("      - uses: actions/checkout@v4");
    if (cfg.backendLang === "python") {
      lines.push("      - uses: actions/setup-python@v5");
      lines.push("        with:");
      lines.push(`          python-version: "${cfg.backendVersion}"`);
      lines.push("      - name: Install dependencies");
      lines.push("        run: pip install -e '.[dev]'");
      lines.push("      - name: Lint & Run Pytest");
      lines.push("        run: |");
      lines.push("          ruff check .");
      lines.push("          pytest --maxfail=1");
    } else if (cfg.backendLang === "java") {
      lines.push("      - uses: actions/setup-java@v4");
      lines.push("        with:");
      lines.push("          distribution: temurin");
      lines.push(`          java-version: "${cfg.backendVersion}"`);
      lines.push("      - name: Build & Test");
      lines.push("        run: mvn test -B");
    } else {
      lines.push("      - uses: actions/setup-node@v4");
      lines.push("        with:");
      lines.push(`          node-version: "${cfg.backendVersion}"`);
      lines.push("      - run: npm ci && npm test");
    }
    lines.push("");
  }

  if (cfg.includeWeb) {
    lines.push("  web-verify:");
    lines.push("    runs-on: ubuntu-latest");
    lines.push("    defaults:");
    lines.push("      run:");
    lines.push(`        working-directory: ${webDir}`);
    lines.push("    steps:");
    lines.push("      - uses: actions/checkout@v4");
    lines.push("      - uses: actions/setup-node@v4");
    lines.push("        with:");
    lines.push('          node-version: "20"');
    lines.push("      - name: Install & Verify");
    lines.push("        run: |");
    lines.push("          npm ci");
    lines.push("          npm run type-check");
    lines.push("          npm run test:unit");
    lines.push("          npm run build");
    lines.push("");
  }

  if (cfg.includeMobile) {
    lines.push("  mobile-verify:");
    lines.push("    runs-on: ubuntu-latest");
    lines.push("    defaults:");
    lines.push("      run:");
    lines.push("        working-directory: mobile");
    lines.push("    steps:");
    lines.push("      - uses: actions/checkout@v4");
    lines.push("      - uses: subosito/flutter-action@v2");
    lines.push("        with:");
    lines.push('          flutter-version: "3.24.0"');
    lines.push("      - name: Analyze & Test");
    lines.push("        run: |");
    lines.push("          flutter pub get");
    lines.push("          flutter analyze");
    lines.push("          flutter test");
    lines.push("");
  }

  return lines.join("\n");
}

export function generateFeatureRunner(cfg: ScaffolderConfig): string {
  return `#!/usr/bin/env bash
# ==============================================================================
# feature-runner.sh
# Drives a feature through the 4-Phase AI SDLC Loop
# Usage: ./scripts/feature-runner.sh --feature "OTP-Phone-Auth"
# ==============================================================================
set -euo pipefail

FEATURE_NAME=""
MAX_LOOPS=${cfg.maxHealingLoops}

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --feature) FEATURE_NAME="$2"; shift ;;
    --max-loops) MAX_LOOPS="$2"; shift ;;
    *) echo "Unknown parameter: $1"; exit 1 ;;
  esac
  shift
done

if [[ -z "$FEATURE_NAME" ]]; then
  read -rp "Enter Feature Identifier (e.g., OTP-Auth): " FEATURE_NAME
fi

SLUG=$(echo "$FEATURE_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-')
PRD_FILE=".ai/specs/\${SLUG}-prd.md"
CONTRACT_FILE=".ai/specs/\${SLUG}-contract.md"

echo "=========================================================="
echo " AI SDLC Feature Pipeline: $FEATURE_NAME"
echo "=========================================================="

# Phase 1: PRD Spec
if [[ ! -f "$PRD_FILE" ]]; then
  echo "[Phase 1/4] Generating PRD stub at $PRD_FILE..."
  cat << EOF > "$PRD_FILE"
# PRD: $FEATURE_NAME

## 1. Feature Identifier & Objective
Implement $FEATURE_NAME across configured targets.

## 2. User Stories & Acceptance Criteria
- **Given** an authorized user, **When** they trigger $FEATURE_NAME, **Then** the system validates input and persists state.

## 3. Permissions & Roles
- Authenticated standard users.

## 4. Data Fields & Constraints
- Define strict types, lengths, and nullability rules here.

## 5. Out of Scope
- Legacy v1 endpoints.
EOF
  echo " -> Edit $PRD_FILE with your AI assistant using .ai/rules/prd-schema.md, then press Enter."
  read -r
fi

# Phase 2: API Contract
if [[ ! -f "$CONTRACT_FILE" ]]; then
  echo "[Phase 2/4] Generating API Contract stub at $CONTRACT_FILE..."
  cat << EOF > "$CONTRACT_FILE"
# API Contract: $FEATURE_NAME

## 1. Backend Schemas & Endpoints (${cfg.backendLang} / ${cfg.backendFramework})
- POST /api/v1/\${SLUG}

## 2. Database Impact
- Migrations and indexes required.

## 3. Client State Mapping (${cfg.includeWeb ? cfg.webFramework : "N/A"} / ${cfg.includeMobile ? cfg.mobileFramework : "N/A"})
- Request/Response DTOs and error states.
EOF
  echo " -> Populate $CONTRACT_FILE using .ai/rules/api-contract.md, then press Enter."
  read -r
fi

# Phase 3: Implementation reminder
echo "[Phase 3/4] Generate stack implementations using rules in .ai/rules/."
echo " -> Press Enter once code changes are written to start Loop Engineering..."
read -r

# Phase 4: Self-Healing Loop Engineering
ATTEMPT=1
while [[ $ATTEMPT -le $MAX_LOOPS ]]; do
  echo "[Phase 4/4] Verification Loop Attempt $ATTEMPT of $MAX_LOOPS..."
  if ./scripts/loop-runner.sh all; then
    echo "✅ Feature '$FEATURE_NAME' passed all linters and tests!"
    exit 0
  else
    echo "❌ Verification failed. Failure log captured in .ai/logs/loop_failure.log"
    if [[ $ATTEMPT -eq $MAX_LOOPS ]]; then
      echo "🛑 Max healing loops ($MAX_LOOPS) reached. Inspect .ai/logs/loop_failure.log manually."
      exit 1
    fi
    echo " -> Feed .ai/logs/loop_failure.log to your AI assistant for a targeted diff patch, then press Enter to retry..."
    read -r
    ((ATTEMPT++))
  fi
done
`;
}
