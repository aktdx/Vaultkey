import os, subprocess, sys

VENV_PYTHON = r"C:\Users\Aamin\Desktop\App\vaultkey\backend\venv\Scripts\python.exe"
BACKEND_DIR = r"C:\Users\Aamin\Desktop\App\vaultkey\backend"

env = dict(os.environ)
env.update({
    "DATABASE_URL": "sqlite:///:memory:",
    "JWT_SECRET": "test_jwt_secret",
    "R2_ACCOUNT_ID": "x", "R2_BUCKET_NAME": "x",
    "R2_ACCESS_KEY_ID": "x", "R2_SECRET_ACCESS_KEY": "x",
    "PYTHONPATH": BACKEND_DIR,
})

steps = [
    ("app.database", "import app.database; print(app.database.DATABASE_URL[:30])"),
    ("app.security", "import app.security; print('sec ok')"),
    ("app.storage",  "import app.storage; print('storage ok')"),
    ("app.routes.auth", "from app.routes.auth import router; print('auth ok')"),
    ("app.routes.files", "from app.routes.files import router; print('files ok')"),
    ("app.routes.shares", "from app.routes.shares import router; print('shares ok')"),
    ("app.routes.access", "from app.routes.access import router; print('access ok')"),
    ("app.routes.activity", "from app.routes.activity import router; print('activity ok')"),
    ("app.main", "from app.main import app; print('app ok')"),
    ("test_audit_transactions", "import test_audit_transactions; print('test module ok')"),
]

for label, code in steps:
    print(f"Testing {label}...", end=" ", flush=True)
    try:
        r = subprocess.run([VENV_PYTHON, "-c", code], capture_output=True, text=True,
                          cwd=BACKEND_DIR, env=env, timeout=15)
        out = (r.stdout + r.stderr).strip().replace('\n', ' ')
        print(f"rc={r.returncode}: {out[:200]}")
    except subprocess.TimeoutExpired:
        print("TIMEOUT (>15s)")
