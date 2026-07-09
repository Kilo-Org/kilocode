#!/usr/bin/env python3
import os
import sys

import paramiko

host = os.environ.get("SSH_HOST", "43.143.227.210")
user = os.environ.get("SSH_USER", "root")
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")

cmds = [
    'find /root -maxdepth 4 -path "*/deploy/enterprise/.env" 2>/dev/null',
    r"""for f in /root/kilocode-main/deploy/enterprise/.env /root/deploy/enterprise/.env; do
  if [ -f "$f" ]; then
    echo "=== $f ==="
    grep -E '^PLATFORM_OIDC|^LOGTO_|^PLATFORM_JWT|^PLATFORM_AUTH|^KILO_SERVER' "$f" || true
  fi
done""",
    "cd /root/kilocode-main/deploy/enterprise 2>/dev/null && docker compose --profile platform ps enterprise-platform 2>/dev/null",
    r"""cd /root/kilocode-main/deploy/enterprise 2>/dev/null && docker compose --profile platform exec -T enterprise-platform env 2>/dev/null | grep PLATFORM_OIDC | sort""",
    "grep -n 'PLATFORM_OIDC' /root/kilocode-main/deploy/enterprise/docker-compose.yml | head -20",
    r"""cd /root/kilocode-main/deploy/enterprise && docker compose --profile platform exec -T enterprise-platform sh -c 'strings /usr/local/bin/enterprise-platform 2>/dev/null | grep vscode | head -5'""",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=pwd, timeout=15)
for cmd in cmds:
    print(">>>", cmd.split("\n")[0][:80])
    _, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out.rstrip())
    if err:
        print("ERR:", err.rstrip())
    print()
client.close()
