"""
Centralized application configuration.

Environment variables → Settings → application. No other module should
call os.getenv() directly; everything flows through `settings`.
"""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "Management Tool API"
    APP_ENV: str = "development"
    DEBUG: bool = True
    # Log every SQL statement to stdout — expensive on slow consoles; opt-in only
    SQL_ECHO: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # Database — password injected via SUPABASE_DB_PASSWORD or a full URL
    DATABASE_URL: str | None = None
    SUPABASE_DB_PASSWORD: str | None = None
    SUPABASE_DB_HOST: str = "db.asuzvovuecxuztynidss.supabase.co"
    SUPABASE_DB_PORT: int = 5432
    SUPABASE_DB_NAME: str = "postgres"
    SUPABASE_DB_USER: str = "postgres"

    # Connection pool
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5
    DB_POOL_RECYCLE: int = 1800  # Supabase idles connections; recycle below their timeout
    DB_POOL_TIMEOUT: int = 30

    # Supabase services (storage configured, not yet implemented)
    SUPABASE_URL: str = "https://asuzvovuecxuztynidss.supabase.co"
    SUPABASE_PUBLISHABLE_KEY: str | None = None
    SUPABASE_SECRET_KEY: str | None = None
    SUPABASE_STORAGE_S3_URL: str = (
        "https://asuzvovuecxuztynidss.storage.supabase.co/storage/v1/s3"
    )

    # Auth / JWT
    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # CORS — comma-separated origins, e.g. "http://localhost:3000"
    CORS_ORIGINS: str = "http://localhost:3000"

    # Redis — cache / rate limiting / job queue. When unset the app degrades
    # gracefully: in-memory rate limiting, no cache, embedded scheduler.
    REDIS_URL: str | None = None
    REDIS_CONNECT_TIMEOUT: float = 5.0
    REDIS_SOCKET_TIMEOUT: float = 5.0

    # Embedded scheduler — dev convenience. In production the arq worker owns
    # scheduled work (cron) so the API process stays stateless and scalable.
    RUN_EMBEDDED_SCHEDULER: bool = True

    # Rate limiting — Redis sliding window when REDIS_URL is set, in-memory
    # token bucket otherwise (single-process only).
    RATE_LIMIT_ENABLED: bool = True

    # Media storage — "local" (UPLOAD_DIR volume) or "s3" (S3-compatible:
    # AWS S3, Supabase Storage, MinIO). S3 keeps uploads off disposable
    # container filesystems in production.
    STORAGE_BACKEND: str = "local"
    UPLOAD_DIR: str = "uploads"
    S3_ENDPOINT_URL: str | None = None  # leave unset for AWS; set for Supabase/MinIO
    S3_REGION: str = "us-east-1"
    S3_BUCKET: str | None = None
    S3_ACCESS_KEY: str | None = None
    S3_SECRET_KEY: str | None = None
    S3_PUBLIC_BASE_URL: str | None = None  # CDN/public URL prefix for stored objects

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.lower() == "production"

    def production_warnings(self) -> list[str]:
        """Misconfigurations that must block or loudly flag a prod boot."""
        warnings = []
        if self.is_production:
            if not self.JWT_SECRET_KEY:
                warnings.append("JWT_SECRET_KEY is empty — tokens are unsignable")
            if not self.DATABASE_URL and not self.SUPABASE_DB_PASSWORD:
                warnings.append("no database configured (DATABASE_URL or SUPABASE_DB_PASSWORD)")
            if self.DEBUG:
                warnings.append("DEBUG=true in production")
        return warnings

    @field_validator(
        "DATABASE_URL",
        "SUPABASE_DB_PASSWORD",
        "SUPABASE_DB_HOST",
        "SUPABASE_DB_NAME",
        "SUPABASE_DB_USER",
        mode="before",
    )
    @classmethod
    def _strip_value(cls, v: str | None) -> str | None:
        """Drop stray whitespace/quotes around .env values — a padded
        credential or hostname silently breaks DNS/auth."""
        if isinstance(v, str):
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1].strip()
            return v
        return v

    @field_validator("DATABASE_URL", mode="after")
    @classmethod
    def _strip_sync_driver(cls, v: str | None) -> str | None:
        """Accept postgresql:// URLs and normalize to the async driver."""
        if v and v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @property
    def database_url(self) -> str:
        """Async SQLAlchemy URL with the password injected from env config."""
        if self.DATABASE_URL:
            url = self.DATABASE_URL
            # Allow a ${SUPABASE_DB_PASSWORD} placeholder inside DATABASE_URL
            if "${SUPABASE_DB_PASSWORD}" in url:
                url = url.replace(
                    "${SUPABASE_DB_PASSWORD}", self.SUPABASE_DB_PASSWORD or ""
                )
            return url
        if not self.SUPABASE_DB_PASSWORD:
            raise ValueError(
                "Database not configured: set DATABASE_URL or SUPABASE_DB_PASSWORD"
            )
        # URL.create quotes the credentials correctly — passwords containing
        # @, :, /, %, etc. would corrupt a hand-built connection string.
        return URL.create(
            "postgresql+asyncpg",
            username=self.SUPABASE_DB_USER,
            password=self.SUPABASE_DB_PASSWORD,
            host=self.SUPABASE_DB_HOST,
            port=self.SUPABASE_DB_PORT,
            database=self.SUPABASE_DB_NAME,
        ).render_as_string(hide_password=False)

    @property
    def database_host_port(self) -> str:
        """Sanitized 'host:port' for error logs — never includes credentials."""
        url = self.DATABASE_URL or ""
        if url:
            try:
                parsed = make_url(url)
                return f"{parsed.host}:{parsed.port or 5432}"
            except Exception:
                return "<unparseable DATABASE_URL>"
        return f"{self.SUPABASE_DB_HOST}:{self.SUPABASE_DB_PORT}"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
