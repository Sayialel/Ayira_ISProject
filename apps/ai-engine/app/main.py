from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import matching, health

app = FastAPI(title="Ayira AI Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(matching.router, prefix="/ai", tags=["matching"])
