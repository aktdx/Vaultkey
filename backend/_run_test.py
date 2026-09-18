import subprocess, sys, os, time

env = {
    **os.environ,
    "DATABASE_URL": "sqlite:///:memory:",
    "JWT_SECRET": "test_jwt_secret_key_for_testing_only",
    "R2_ACCOUNT_ID": "test_account",
    "R2_BUCKET_NAME": "test_bucket",
    "R2_ACCESS_KEY_ID": "test_key",
    "R2_SECRET_ACCESS_KEY": "test_secret",
}

print(f"Starting at {time.strftime('%H:%M:%S')}")
try:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "test_streaming.py", "-v", "--tb=short", "-x"],
        capture_output=True, text=True, timeout=45, cwd=".", env=env
    )
    print(f"Done at {time.strftime('%H:%M:%S')}")
    print(f"rc={result.returncode}")
    out = result.stdout + result.stderr
    print(out[-3000:] if len(out) > 3000 else out)
except subprocess.TimeoutExpired:
    print(f"TIMEOUT at {time.strftime('%H:%M:%S')}")
