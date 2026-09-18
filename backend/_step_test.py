import os
os.environ["R2_ACCOUNT_ID"] = "x"
os.environ["R2_BUCKET_NAME"] = "x"
os.environ["R2_ACCESS_KEY_ID"] = "x"
os.environ["R2_SECRET_ACCESS_KEY"] = "x"
os.environ["JWT_SECRET"] = "testsecret"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

print("about to import storage...")
from app.storage import generate_object_key
print("storage imported OK")
