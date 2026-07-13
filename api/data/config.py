"""Application settings (pydantic-settings).

Reads ``ENVIRONMENT`` (not ``ENV``) to match ``log.py`` + ``docker-compose.yml``
(ledger §16-R1); dev-login gates on ``environment == "development"`` so it must
read the same var. CORS origins deliberately stay in ``middleware.ALLOWED_ORIGINS``
(single source, §16-R2) rather than being duplicated here.
"""

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
    cookie_domain: str | None = None  # ".filecast.io" in prod, None in dev
    cookie_secure: bool = False  # True in prod (HTTPS), False on localhost
    site_origin: str = "http://localhost:8000"

    # Anti-abuse
    fingerprint_salt: str = "dev-salt"
    trusted_proxies: str = ""  # comma-separated IPs allowed to set XFF

    # Retention
    retention_days: int = 30

    # Phase 5: google_client_id/secret ; Phase 7: github_pat, deploy config

    model_config = SettingsConfigDict(env_prefix="", env_file=".env", extra="ignore")

    @property
    def trusted_proxy_set(self) -> set[str]:
        return {p.strip() for p in self.trusted_proxies.split(",") if p.strip()}


settings = Settings()
