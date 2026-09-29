import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from .limiter import limiter
from .database import engine, Base, get_db
from .routes import auth, files, shares, access, activity

# Initialize DB tables for development/test environments
# In production, run: alembic upgrade head
if os.environ.get("ENVIRONMENT", "development") != "production":
    Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="VaultKey API",
    description="Privacy-focused Client-Side Encrypted File Sharing API",
    version="1.0.0"
)

# Rate limiter — keyed by client IP (defined in limiter.py to avoid circular imports)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS configuration — driven by ALLOWED_ORIGINS env var; no wildcard permitted
origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000",
).split(",")
if "https://vaultkey.local" not in origins:
    origins.append("https://vaultkey.local")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-IV-Hex", "X-Original-Filename", "X-Mime-Type"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(files.router)
app.include_router(shares.router)
app.include_router(access.router)
app.include_router(activity.router)

@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    """
    Health check endpoint that verifies actual system dependencies.
    Returns HTTP 200 if healthy, HTTP 503 if degraded.
    """
    checks = {
        "app": "VaultKey",
        "version": "1.0.0",
        "db": "ok",
    }
    
    # Check database connectivity
    try:
        db.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as e:
        checks["db"] = "error"
        checks["db_error"] = str(e)
    
    # Optional: Check R2 storage connectivity (lightweight check)
    # Uncomment if needed:
    # try:
    #     from .storage import _get_client
    #     s3 = _get_client()
    #     s3.list_buckets()  # Lightweight connectivity test
    #     checks["storage"] = "ok"
    # except Exception as e:
    #     checks["storage"] = "error"
    #     checks["storage_error"] = str(e)
    
    # Determine overall status
    checks["status"] = "ok" if checks["db"] == "ok" else "degraded"
    status_code = 200 if checks["status"] == "ok" else 503
    
    return JSONResponse(content=checks, status_code=status_code)
