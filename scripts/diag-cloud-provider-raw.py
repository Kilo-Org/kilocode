#!/usr/bin/env python3
import os
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("43.143.227.210", username="root", password=os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#"), timeout=15)

cmd = r"""
cd /root/kilocode-main/deploy/enterprise
tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token -H 'Content-Type: application/json' -d '{"email":"admin@enterprise.local"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
for path in provider providers config global/health; do
  echo "=== /kilo/$path ==="
  curl -s -w ' http=%{http_code} len=%{size_download}\n' "https://wab.flyfishphp.cn/kilo/$path" -H "Authorization: Bearer $tok" | head -c 800
  echo; echo
done
curl -s http://127.0.0.1:4096/provider | head -c 500
echo
"""
_, stdout, _ = client.exec_command(cmd, timeout=60)
print(stdout.read().decode())
client.close()
