import secrets

from fastapi import Header, HTTPException, status

from app.config import settings

API_KEY_HEADER = "X-Ayira-Key"


async def require_api_key(x_ayira_key: str = Header(default="")) -> None:
    """
    Rejects any caller that does not present the shared secret.

    The engine reads worker profiles and every open gig using the service-role
    key, and Phase 7 deploys it as its own internet-facing Railway service. Left
    open, anyone could request scored gigs for any worker_id.

    Refusing outright when the secret is unset is deliberate: a service that
    silently allows everything when misconfigured is how this kind of gap
    reaches production unnoticed.
    """
    if not settings.ai_engine_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "AI_ENGINE_SECRET is not configured. Set it in .env for both "
                "the engine and the API gateway."
            ),
        )

    # Constant-time comparison, so response timing cannot be used to recover
    # the secret one character at a time.
    if not secrets.compare_digest(x_ayira_key, settings.ai_engine_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key.",
        )
