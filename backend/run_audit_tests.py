"""
Runner for audit-transaction tests + key regression suites.
Same pattern as run_view_only_tests.py (known to work).

Audit tests use live Neon DB + R2 (same as all other integration tests here).
The test_audit_transactions.py overrides the engine to SQLite internally,
but the runner still loads .env so other env vars (JWT_SECRET, R2_*) are set.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

BACKEND_DIR = r"C:\Users\Aamin\Desktop\App\vaultkey\backend"
VENV_PYTHON = os.path.join(BACKEND_DIR, "venv", "Scripts", "python.exe")
python_exe = VENV_PYTHON if os.path.exists(VENV_PYTHON) else sys.executable

# Load .env into env (setdefault — don't override OS-level vars)
env = dict(os.environ)
env_file = Path(BACKEND_DIR) / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env.setdefault(key.strip(), value.strip())
    print(f"Loaded .env from {env_file}")

env["PYTHONPATH"] = BACKEND_DIR

suites = [
    ("test_audit_transactions.py", "pytest_audit_results.txt"),
    ("test_view_only.py",          "pytest_viewonly_check.txt"),
    ("test_security_preservation.py", "pytest_preservation_check.txt"),
]

for test_file, out_file in suites:
    print(f"\nRunning {test_file}...")
    result = subprocess.run(
        [python_exe, "-m", "pytest",
         os.path.join(BACKEND_DIR, test_file),
         "-v", "--tb=short", "-p", "no:cacheprovider"],
        capture_output=True, text=True, cwd=BACKEND_DIR, env=env,
        timeout=120,
    )
    output = result.stdout + result.stderr + f"\n=== Exit code: {result.returncode} ===\n"
    out_path = os.path.join(BACKEND_DIR, out_file)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(output)
    print(output[-1500:] if len(output) > 1500 else output)
    print(f"Saved to {out_file}")

time.sleep(5)
