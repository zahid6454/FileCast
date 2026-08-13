"""Application settings (pydantic-settings).

Reads ``ENVIRONMENT`` (not ``ENV``) to match ``log.py`` + ``docker-compose.yml``
(ledger §16-R1); dev-login gates on ``environment == "development"`` so it must
read the same var. CORS origins deliberately stay in ``middleware.ALLOWED_ORIGINS``
(single source, §16-R2) rather than being duplicated here.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    database_url: str = (
        "postgresql+psycopg://filecast:filecast_dev@localhost:5432/filecast"
    )

    # Sessions / cookies
    session_cookie_name: str = "fc_session"
    logged_in_cookie_name: str = "fc_logged_in"
    session_ttl_days: int = 30
    cookie_domain: str | None = None  # ".filecast.org" in prod, None in dev
    cookie_secure: bool = False  # True in prod (HTTPS), False on localhost
    site_origin: str = "http://localhost:8000"

    # Anti-abuse
    fingerprint_salt: str = "dev-salt"
    trusted_proxies: str = ""  # comma-separated IPs allowed to set XFF

    # Retention
    retention_days: int = 30

    # Google OAuth (Phase 5) — optional. Unset client id/secret ⇒ the Google
    # auth routes return 503 and dev-login still works (spec §1, D-locked).
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8090/api/v1/auth/google/callback"
    oauth_state_cookie_name: str = "fc_oauth_state"
    oauth_state_ttl_seconds: int = 600

    # Phase 5.5: bootstrap admins. Comma-separated allow-list of emails that are
    # ALWAYS admin on Google login (break-glass owners; never revocable via the UI).
    # Effectively REQUIRED in production — with it empty and no pre-existing admin
    # row there is no path to a first admin (main.py warns at startup).
    initial_admin_emails: str = ""

    # Phase 7: server-side deploy trigger (D7/P18). The PAT is held ONLY in the
    # backend .env — never a GitHub Actions secret (the backend IS the dispatcher)
    # and never returned in any response. Empty ⇒ POST /admin/deploy fails with a
    # real 5xx (NOT 501 — api.js swallows 501 into a calm "pending rebuild" banner).
    #
    # ⚠ These read the bare GITHUB_* env vars (env_prefix=""). Fine on the prod
    # host — docker-compose sets none of them — and the owner docs name
    # ``GITHUB_PAT`` in the prod .env, so those three keep their bare names.
    #
    # ``github_workflow`` is the exception: GitHub Actions RESERVES
    # ``GITHUB_WORKFLOW=<name>`` as a built-in, so inside a runner the bare name
    # silently won over the .env value and dispatched to a workflow named after
    # the CI job (this bit CI in Phase 7). Reading an app-namespaced var instead
    # removes the collision outright rather than relying on never running the
    # backend in a runner. The default is already correct, and no environment
    # sets this today, so nothing needs migrating — set
    # ``FILECAST_GITHUB_WORKFLOW`` if you ever need to override it.
    github_pat: str = ""
    github_owner: str = "zahid6454"
    github_repo: str = "FileCast"
    github_workflow: str = Field(
        default="deploy.yml", validation_alias="FILECAST_GITHUB_WORKFLOW"
    )

    # Phase 9 §9.2: backend error tracking, separate Sentry project from the
    # frontend one (different platform, own DSN). Empty ⇒ sentry_sdk.init() is
    # never called at all (main.py checks before calling it) — same
    # guarded-if-configured shape as the Google OAuth / GitHub PAT settings above.
    sentry_dsn: str = ""
    # Performance tracing (distributed traces, not just error capture). 1.0 =
    # every request traced — current traffic is low enough (the busiest rate
    # limit is 120/hr) that full sampling costs nothing meaningful; dial this
    # down via env once volume makes that worth doing.
    sentry_traces_sample_rate: float = 1.0

    model_config = SettingsConfigDict(env_prefix="", env_file=".env", extra="ignore")

    @property
    def trusted_proxy_set(self) -> set[str]:
        return {p.strip() for p in self.trusted_proxies.split(",") if p.strip()}

    @property
    def google_oauth_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def initial_admin_email_set(self) -> set[str]:
        return {
            e.strip().lower() for e in self.initial_admin_emails.split(",") if e.strip()
        }


settings = Settings()
