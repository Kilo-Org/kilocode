#!/usr/bin/env python3
"""Remote smoke for AD Pro APIs on cloud platform."""
import os
import sys

import paramiko

HOST = os.environ.get("SSH_HOST", "43.143.227.210")
PWD = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")

SCRIPT = r"""
set -e
BASE=http://127.0.0.1:8090
tok=$(curl -sf -X POST $BASE/api/v1/auth/dev-token \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@enterprise.local"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
H="Authorization: Bearer $tok"

echo "=== version ==="
curl -sf $BASE/api/v1/version

echo ""
echo "=== admin ==="
curl -s -o /dev/null -w "admin %{http_code}\n" $BASE/admin/

echo "=== roles ==="
curl -sf $BASE/api/v1/roles -H "$H" | head -c 120

echo ""
echo "=== usage detail ==="
curl -sf "$BASE/api/v1/usage/detail?days=7" -H "$H" | head -c 120

echo ""
echo "=== licenses ==="
curl -sf $BASE/api/v1/licenses -H "$H" | head -c 120

echo ""
echo "=== audit page ==="
curl -sf "$BASE/api/v1/audit/logs?page=1&pageSize=5" -H "$H" | head -c 120

echo ""
echo "=== model-config apiKeyEnv ==="
curl -sf -X PUT $BASE/api/v1/model-config -H "$H" -H 'Content-Type: application/json' \
  -d '{"provider":"deepseek","apiBase":"https://api.deepseek.com/v1","defaultModel":"deepseek-v4-pro","smallModel":"deepseek-v4-flash","apiKeyEnv":"KILO_CUSTOM_API_KEY"}' | head -c 80
echo ""
cfg=$(curl -sf $BASE/api/v1/model-config -H "$H")
echo "$cfg" | grep -q apiKeyEnv && echo "apiKeyEnv ok"

echo ""
echo "=== user detail ==="
uid=$(curl -sf $BASE/api/v1/users -H "$H" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
curl -sf "$BASE/api/v1/users/$uid" -H "$H" | head -c 120

echo ""
echo "[verify-ad] OK"
"""


def main() -> int:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[verify-ad] connect root@{HOST}")
    c.connect(HOST, username="root", password=PWD, timeout=30)
    _, o, e = c.exec_command(SCRIPT, timeout=120)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(out.encode("utf-8", errors="replace"))
    if err.strip():
        sys.stderr.buffer.write(err.encode("utf-8", errors="replace"))
    c.close()
    if code != 0:
        print(f"[verify-ad] exit {code}", file=sys.stderr)
        return code
    if "[verify-ad] OK" not in out:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
