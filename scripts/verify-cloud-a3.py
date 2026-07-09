#!/usr/bin/env python3
import json
import os
import sys

import paramiko

host = os.environ.get("SSH_HOST", "43.143.227.210")
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, username="root", password=pwd, timeout=30)

script = r"""
set -e
tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@enterprise.local"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
echo "version: $(curl -sf http://127.0.0.1:8090/api/v1/version)"
echo "roles: $(curl -sf http://127.0.0.1:8090/api/v1/roles -H "Authorization: Bearer $tok" | head -c 200)"
"""

_, o, e = c.exec_command(script, timeout=60)
out = o.read().decode("utf-8", errors="replace")
err = e.read().decode("utf-8", errors="replace")
sys.stdout.buffer.write(out.encode("utf-8", errors="replace"))
if err.strip():
    sys.stderr.buffer.write(err.encode("utf-8", errors="replace"))
c.close()

if "roles" not in out or "404" in out:
    sys.exit(1)
