#!/usr/bin/env python3
import os
import paramiko

host = "43.143.227.210"
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
dir = "/root/kilocode-main/deploy/enterprise"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=pwd, timeout=15)

cmd = r"""
cd /root/kilocode-main/deploy/enterprise
echo '=== dev-token ==='
curl -s -w '\nHTTP:%{http_code}\n' -X POST http://127.0.0.1:8090/api/v1/auth/dev-token \
  -H 'Content-Type: application/json' -d '{"email":"admin@enterprise.local"}' | head -c 400
echo
echo '=== engine health basic ==='
curl -s -w '\nHTTP:%{http_code}\n' -u kilo:abc12345 http://127.0.0.1:4096/global/health
echo
echo '=== create session ==='
sid=$(curl -sf -u kilo:abc12345 -X POST http://127.0.0.1:4096/session \
  -H 'Content-Type: application/json' -d '{"title":"diag"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo session=$sid
echo '=== prompt async ==='
curl -s -w '\nHTTP:%{http_code}\n' -u kilo:abc12345 -X POST "http://127.0.0.1:4096/session/$sid/prompt_async" \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"say hi in one word"}],"agent":"ask"}' | head -c 500
echo
sleep 8
echo '=== messages ==='
curl -s -u kilo:abc12345 "http://127.0.0.1:4096/session/$sid/message" | python3 -c "
import sys,json
data=json.load(sys.stdin)
for m in data:
    role=m.get('info',{}).get('role','?')
    err=m.get('info',{}).get('error')
    parts=[p.get('type') for p in m.get('parts',[])]
    print(role, 'parts', parts, 'err', err)
"
echo '=== engine logs ==='
docker compose logs kilo-engine --since 5m 2>&1 | tail -30
"""

print(">>> remote diag")
_, stdout, stderr = client.exec_command(cmd, timeout=180)
print(stdout.read().decode()[:8000])
err = stderr.read().decode()
if err:
    print("ERR:", err[:2000])
client.close()
