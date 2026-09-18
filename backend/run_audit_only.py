"""Re-run just the audit tests with the email fix applied."""
import os, subprocess, sys, time
from pathlib import Path

BACKEND_DIR = r"C:\Users\Aamin\Desktop\App\vaultkey\backend"
VENV_PYTHON = os.path.join(BACKEND_DIR, "venv", "Scripts", "python.exe")

env = dict(os.environ)
for line in (Path(BACKEND_DIR) / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    env.setdefault(k.strip(), v.strip())
env["PYTHONPATH"] = BACKEND_DIR

result = subprocess.run(
    [VENV_PYTHON, "-m", "pytest", "test_audit_transactions.py",
     "-v", "--tb=short", "-p", "no:cacheprovider"],
    capture_output=True, text=True, cwd=BACKEND_DIR, env=env, timeout=120,
)
out = result.stdout + result.stderr + f"\n=== Exit code: {result.returncode} ===\n"
(Path(BACKEND_DIR) / "pytest_audit_results.txt").write_text(out, encoding="utf-8")
print(out)
time.sleep(3)
