from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")
print("dotenv loaded")
from fastapi.testclient import TestClient
print("TestClient imported")
from app.main import app
print("app imported")
from app.database import SessionLocal
print("SessionLocal imported")
