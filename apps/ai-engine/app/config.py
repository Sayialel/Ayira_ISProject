from pydantic_settings import BaseSettings


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

    class Config:
        env_file = "../../.env"


settings = Settings()
