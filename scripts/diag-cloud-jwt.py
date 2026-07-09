#!/usr/bin/env python3
import json
import os
import urllib.request

import paramiko

host = "43.143.227.210"
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=pwd, timeout=15)

cmds = [
    "grep -E 'secret:|PLATFORM_JWT' /root/kilocode-main/deploy/enterprise/apisix/apisix.yaml | head -5",
    "grep '^PLATFORM_JWT' /root/kilocode-main/deploy/enterprise/.env",
    "cd /root/kilocode-main/deploy/enterprise && PLATFORM_URL=http://127.0.0.1:8090 GATEWAY_URL=http://127.0.0.1:9080 ./scripts/smoke-phase2-sso.sh 2>&1 || true",
    "cd /root/kilocode-main/deploy/enterprise && PLATFORM_URL=http://127.0.0.1:8090 GATEWAY_URL=https://wab.flyfishphp.cn ./scripts/smoke-phase2-sso.sh 2>&1 || true",
]
for cmd in cmds:
    print(">>>", cmd[:100])
    _, o, e = client.exec_command(cmd, timeout=60)
    print(o.read().decode() or e.read().decode())
    print()
client.close()
