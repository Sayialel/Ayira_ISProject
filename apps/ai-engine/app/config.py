from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The monorepo keeps a single .env at its root. Resolving it from __file__
# rather than the working directory means the engine starts the same way
# whether it is launched from apps/ai-engine, from the repo root, or by a
# process manager with its own cwd.
#   parents[0] app/  [1] ai-engine/  [2] apps/  [3] repo root
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    model_name: str = "all-MiniLM-L6-v2"
    api_port: int = 8001

    # Shared secret the API gateway presents on every call. The engine exposes
    # worker data and is deployed as its own public service, so it cannot rely
    # on being unreachable. Empty means "not configured", which the dependency
    # in app/security.py treats as a hard failure rather than an open door.
    ai_engine_secret: str = ""

    # extra="ignore" is essential, not cosmetic: the .env is shared with the
    # API gateway and the web app, so it carries DARAJA_*, AT_*, FCM_* and
    # VITE_* keys this service knows nothing about. Pydantic Settings v2
    # defaults to forbidding unknown keys, which made the engine crash on
    # startup against the real .env.
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        # "model_name" would otherwise collide with Pydantic's reserved
        # "model_" prefix and warn on every import.
        protected_namespaces=(),
    )


settings = Settings()
