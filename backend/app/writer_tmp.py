import base64, pathlib
pathlib.Path(r"c:/Users/Aamin/Desktop/App/vaultkey/backend/app/storage.py").write_bytes(base64.b64decode(open(r"c:/Users/Aamin/Desktop/App/vaultkey/backend/app/storage_b64.txt").read().strip()))
print("done")