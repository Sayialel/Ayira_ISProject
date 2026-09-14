from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    model_name: str = "all-MiniLM-L6-v2"
    api_port: int = 8001

    class Config:
        env_file = "../../.env"

settings = Settings()
