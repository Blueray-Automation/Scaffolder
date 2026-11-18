# Reference: the login implementation

This is the complete, **verified** code for the sample login feature from [Tutorial: Add a Login API](Tutorial-Add-a-Login-API).
It was generated from the default template (FastAPI, PostgreSQL, Next.js) and passed `./scripts/sdlc verify` with all 29 checks,
including the login checks against the running Docker stack.

Use it to compare with your own work or as a starting point. It is a **sample**: one demo user from environment variables,
no users table. See [What to change before real use](Tutorial-Add-a-Login-API#what-to-change-before-real-use).

## 1. Spec (`.ai/specs/FEAT-001-user-login/`)

### prd.md

```markdown
# FEAT-001: User Login

Status: Accepted (sample feature)

## 1. Objective
Let a known user prove who they are with an email and password and receive a short-lived access token, then use that token to call a protected endpoint. This is a deliberately small sample: one demo user, no registration.

## 2. User stories & acceptance criteria
- **AC-001** Given the demo user exists, when a client sends `POST /api/v1/auth/login` with that user's email and password, then it responds `200` with `{"access_token": <string>, "token_type": "bearer"}`.
- **AC-002** Given the demo user exists, when the password is wrong, then it responds `401` with `{"detail": "Invalid email or password"}`.
- **AC-003** Given an email that does not belong to any user, when a client logs in, then it responds `401` with the same body as AC-002, so the response never reveals which emails exist.
- **AC-004** Given a malformed body (an email that is not an email, or an empty password), when a client logs in, then it responds `422`.
- **AC-005** Given a valid access token, when a client sends `GET /api/v1/auth/me` with `Authorization: Bearer <token>`, then it responds `200` with the token owner's `{"email": ...}`.
- **AC-006** Given no token, a malformed token, or an expired token, when a client calls `GET /api/v1/auth/me`, then it responds `401`.

## 3. Permissions & roles
`/auth/login` is public. `/auth/me` requires a valid access token. No roles.

## 4. Data & validation
- `email`: string matching `local@domain.tld`, max 254 characters.
- `password`: string, 1 to 128 characters.
- Access token: signed JWT (HS256) with `sub` = email and a 15-minute expiry.
- The signing key and the demo user come from environment variables (`JWT_SECRET`, `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`). There is no default key: the app refuses to start if a demo user is configured without a `JWT_SECRET` of at least 32 characters. With no demo user configured, every login is rejected.

## 5. Contract impact
New endpoints `POST /api/v1/auth/login` and `GET /api/v1/auth/me`. New schemas `LoginRequest`, `TokenResponse`, `MeResponse`. No migrations.

## 6. Out of scope
Registration, refresh tokens, password reset, a users table, roles, rate limiting, and the web UI for logging in.

## 7. Verification map
See `acceptance.json`. AC-001 to AC-004 and the missing/malformed cases of AC-006 are proven against the running service. AC-005 and the expired-token case of AC-006 need a valid or an expired token, so they are tied to specific tests with `cmd` checks (the HTTP check format cannot carry a token from one request to the next).
```

### acceptance.json

```json
{
  "feature": "FEAT-001",
  "checks": [
    {
      "id": "CHK-001",
      "name": "Valid credentials return a bearer token",
      "covers": ["AC-001"],
      "type": "http",
      "target": "backend",
      "method": "POST",
      "path": "/api/v1/auth/login",
      "body": { "email": "demo@example.com", "password": "demo-pass" },
      "expect": { "status": 200, "json": { "access_token": "$type:string", "token_type": "bearer" } }
    },
    {
      "id": "CHK-002",
      "name": "Wrong password is rejected with a generic message",
      "covers": ["AC-002"],
      "type": "http",
      "target": "backend",
      "method": "POST",
      "path": "/api/v1/auth/login",
      "body": { "email": "demo@example.com", "password": "not-the-password" },
      "expect": { "status": 401, "json": { "detail": "Invalid email or password" } }
    },
    {
      "id": "CHK-003",
      "name": "Unknown email gets the same response as a wrong password",
      "covers": ["AC-003"],
      "type": "http",
      "target": "backend",
      "method": "POST",
      "path": "/api/v1/auth/login",
      "body": { "email": "nobody@example.com", "password": "whatever" },
      "expect": { "status": 401, "json": { "detail": "Invalid email or password" } }
    },
    {
      "id": "CHK-004",
      "name": "Malformed body is rejected with 422",
      "covers": ["AC-004"],
      "type": "http",
      "target": "backend",
      "method": "POST",
      "path": "/api/v1/auth/login",
      "body": { "email": "not-an-email", "password": "" },
      "expect": { "status": 422 }
    },
    {
      "id": "CHK-005",
      "name": "A token from login opens /me (login then /me, unit test)",
      "covers": ["AC-005"],
      "type": "cmd",
      "cwd": "backend",
      "pathPrepend": ["backend/.venv/bin"],
      "run": "pytest -q tests/test_auth.py::test_me_returns_the_token_owner",
      "expectExit": 0
    },
    {
      "id": "CHK-006",
      "name": "/me without a token is rejected",
      "covers": ["AC-006"],
      "type": "http",
      "target": "backend",
      "path": "/api/v1/auth/me",
      "expect": { "status": 401 }
    },
    {
      "id": "CHK-007",
      "name": "/me with a malformed token is rejected",
      "covers": ["AC-006"],
      "type": "http",
      "target": "backend",
      "path": "/api/v1/auth/me",
      "headers": { "Authorization": "Bearer not-a-real-token" },
      "expect": { "status": 401 }
    },
    {
      "id": "CHK-008",
      "name": "/me with an expired token is rejected (unit test)",
      "covers": ["AC-006"],
      "type": "cmd",
      "cwd": "backend",
      "pathPrepend": ["backend/.venv/bin"],
      "run": "pytest -q tests/test_auth.py::test_me_rejects_an_expired_token",
      "expectExit": 0
    }
  ]
}
```

## 2. Dependency (`backend/pyproject.toml`)

Add one line to `dependencies`:

```toml
    "pyjwt>=2.9,<3",
```

Then reinstall: `cd backend && .venv/bin/pip install -e ".[dev]"` (or run `./scripts/sdlc setup` again).

## 3. Settings (`backend/app/core/config.py`)

```python
"""Typed settings. Every value comes from the environment (see ../../.env.example)."""

from functools import lru_cache
from typing import Self

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "hello-scaffold"
    app_env: str = "development"
    cors_origins: str = "http://localhost:3000"
    database_url: str | None = None

    @field_validator("database_url", mode="before")
    @classmethod
    def _empty_database_url_means_unset(cls, value: object) -> object:
        return None if value in ("", None) else value

    # Demo login (FEAT-001). No defaults: nothing is configured unless the environment says so.
    jwt_secret: str | None = None
    demo_user_email: str | None = None
    demo_user_password: str | None = None

    @field_validator("jwt_secret", "demo_user_email", "demo_user_password", mode="before")
    @classmethod
    def _empty_means_unset(cls, value: object) -> object:
        return None if value == "" else value

    @model_validator(mode="after")
    def _demo_user_needs_a_strong_signing_key(self) -> Self:
        if self.demo_user_email and (self.jwt_secret is None or len(self.jwt_secret) < 32):
            raise ValueError(
                "JWT_SECRET (at least 32 characters) is required when DEMO_USER_EMAIL is set"
            )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

## 4. Passwords and tokens (`backend/app/core/security.py`, new)

```python
"""Password check and access tokens for the demo login."""

import hmac
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import Settings

ALGORITHM = "HS256"
TOKEN_LIFETIME = timedelta(minutes=15)


def verify_credentials(settings: Settings, email: str, password: str) -> bool:
    """Constant-time comparison; with no demo user configured nobody can log in."""
    if not settings.demo_user_email or not settings.demo_user_password:
        return False
    email_matches = hmac.compare_digest(email.encode(), settings.demo_user_email.encode())
    password_matches = hmac.compare_digest(password.encode(), settings.demo_user_password.encode())
    return email_matches and password_matches


def create_access_token(settings: Settings, email: str) -> str:
    if settings.jwt_secret is None:
        raise RuntimeError("JWT_SECRET is not configured")
    now = datetime.now(UTC)
    claims = {"sub": email, "iat": now, "exp": now + TOKEN_LIFETIME}
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(settings: Settings, token: str) -> str | None:
    """The token's subject, or None for anything invalid (malformed, forged, expired)."""
    if settings.jwt_secret is None:
        return None
    try:
        claims = jwt.decode(
            token, settings.jwt_secret, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]}
        )
    except jwt.PyJWTError:
        return None
    subject = claims.get("sub")
    return subject if isinstance(subject, str) else None
```

## 5. Request and response models (`backend/app/schemas/auth.py`, new)

```python
from typing import Literal

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 (the OAuth2 token type, not a password)


class MeResponse(BaseModel):
    email: str
```

## 6. The endpoints (`backend/app/api/v1/auth.py`, new)

```python
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.security import create_access_token, decode_access_token, verify_credentials
from app.schemas.auth import LoginRequest, MeResponse, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])

# auto_error=False: we answer 401 ourselves, uniformly, for every kind of bad credential.
bearer_scheme = HTTPBearer(auto_error=False)
SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={401: {"description": "Invalid email or password"}},
    summary="Exchange credentials for an access token",
)
async def login(body: LoginRequest, settings: SettingsDep) -> TokenResponse:
    if not verify_credentials(settings, body.email, body.password):
        # Same answer for "unknown email" and "wrong password": never reveal which emails exist.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )
    return TokenResponse(access_token=create_access_token(settings, body.email))


async def current_user_email(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    settings: SettingsDep,
) -> str:
    email = decode_access_token(settings, credentials.credentials) if credentials else None
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return email


@router.get(
    "/me",
    response_model=MeResponse,
    responses={401: {"description": "Missing, malformed or expired token"}},
    summary="Who am I?",
)
async def me(email: Annotated[str, Depends(current_user_email)]) -> MeResponse:
    return MeResponse(email=email)
```

## 7. Register the router (`backend/app/api/v1/router.py`)

```python
from fastapi import APIRouter

from app.api.v1 import auth, hello

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(hello.router)
api_router.include_router(auth.router)
```

## 8. Tests (`backend/tests/test_auth.py`, new)

```python
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.security import ALGORITHM, create_access_token

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo-pass"
SIGNING_KEY = "unit-test-signing-key-0123456789abcdef"


@pytest.fixture(autouse=True)
def _demo_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEMO_USER_EMAIL", DEMO_EMAIL)
    monkeypatch.setenv("DEMO_USER_PASSWORD", DEMO_PASSWORD)
    monkeypatch.setenv("JWT_SECRET", SIGNING_KEY)
    get_settings.cache_clear()


def login(client: TestClient, email: str = DEMO_EMAIL, password: str = DEMO_PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_login_returns_a_bearer_token_for_the_demo_user(client: TestClient) -> None:
    response = login(client)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    claims = jwt.decode(body["access_token"], SIGNING_KEY, algorithms=[ALGORITHM])
    assert claims["sub"] == DEMO_EMAIL


def test_login_rejects_a_wrong_password(client: TestClient) -> None:
    response = login(client, password="not-the-password")

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


def test_login_answers_an_unknown_email_exactly_like_a_wrong_password(client: TestClient) -> None:
    unknown = login(client, email="nobody@example.com")
    wrong = login(client, password="not-the-password")

    assert (unknown.status_code, unknown.json()) == (wrong.status_code, wrong.json())


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email", "password": "x"},
        {"email": DEMO_EMAIL, "password": ""},
        {"email": DEMO_EMAIL, "password": "x" * 129},
        {"email": DEMO_EMAIL},
        {},
    ],
    ids=["bad-email", "empty-password", "password-too-long", "missing-password", "empty-body"],
)
def test_login_rejects_malformed_bodies_with_422(
    client: TestClient, payload: dict[str, str]
) -> None:
    assert client.post("/api/v1/auth/login", json=payload).status_code == 422


def test_login_is_closed_when_no_demo_user_is_configured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("DEMO_USER_EMAIL")
    monkeypatch.delenv("DEMO_USER_PASSWORD")
    get_settings.cache_clear()

    assert login(client).status_code == 401


def test_me_returns_the_token_owner(client: TestClient) -> None:
    token = login(client).json()["access_token"]

    response = client.get("/api/v1/auth/me", headers=bearer(token))

    assert response.status_code == 200
    assert response.json() == {"email": DEMO_EMAIL}


@pytest.mark.parametrize(
    "headers",
    [{}, bearer("not-a-token"), {"Authorization": "Basic ZGVtbzpkZW1v"}],
    ids=["missing", "malformed", "wrong-scheme"],
)
def test_me_rejects_missing_or_malformed_credentials(
    client: TestClient, headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/auth/me", headers=headers)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_me_rejects_an_expired_token(client: TestClient) -> None:
    expired = jwt.encode(
        {"sub": DEMO_EMAIL, "exp": datetime.now(UTC) - timedelta(minutes=1)},
        SIGNING_KEY,
        algorithm=ALGORITHM,
    )

    assert client.get("/api/v1/auth/me", headers=bearer(expired)).status_code == 401


def test_me_rejects_a_token_signed_with_another_key(client: TestClient) -> None:
    forged = jwt.encode(
        {"sub": DEMO_EMAIL, "exp": datetime.now(UTC) + timedelta(minutes=5)},
        "some-other-signing-key-0123456789abcdef",
        algorithm=ALGORITHM,
    )

    assert client.get("/api/v1/auth/me", headers=bearer(forged)).status_code == 401


def test_me_rejects_a_token_without_a_subject(client: TestClient) -> None:
    anonymous = jwt.encode(
        {"exp": datetime.now(UTC) + timedelta(minutes=5)}, SIGNING_KEY, algorithm=ALGORITHM
    )

    assert client.get("/api/v1/auth/me", headers=bearer(anonymous)).status_code == 401


def test_settings_refuse_a_demo_user_without_a_strong_signing_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("JWT_SECRET", "too-short")

    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings()


def test_tokens_cannot_be_created_without_a_signing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEMO_USER_EMAIL")
    monkeypatch.delenv("DEMO_USER_PASSWORD")
    monkeypatch.delenv("JWT_SECRET")

    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        create_access_token(Settings(), DEMO_EMAIL)
```

## 9. Environment for Docker

In `docker-compose.yml`, under `backend` -> `environment`, next to `APP_ENV`:

```yaml
      JWT_SECRET: ${JWT_SECRET:-dev-only-signing-key-change-me-0123456789}
      DEMO_USER_EMAIL: ${DEMO_USER_EMAIL:-demo@example.com}
      DEMO_USER_PASSWORD: ${DEMO_USER_PASSWORD:-demo-pass}
```

and the same three names in `.env.example`. These are development defaults only. A real environment sets its own values
(`JWT_SECRET` of at least 32 random characters), for example as GitHub Environment secrets.

## 10. Update the API contract (intentional change)

```bash
cd backend && python -m app.export_openapi --write ../.ai/contract/openapi.json
```

Review the diff: it should add `/api/v1/auth/login`, `/api/v1/auth/me` and the three new schemas, and nothing else.
