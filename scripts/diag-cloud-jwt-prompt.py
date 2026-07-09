#!/usr/bin/env python3
import os
import paramiko

host = "43.143.227.210"
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=pwd, timeout=15)

cmd = r"""
cd /root/kilocode-main/deploy/enterprise
tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token \
  -H 'Content-Type: application/json' -d '{"email":"admin@enterprise.local"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
echo token_len=${#tok}
echo '=== apisix jwt health public ==='
curl -s -w '\nHTTP:%{http_code}\n' https://wab.flyfishphp.cn/kilo/global/health -H "Authorization: Bearer $tok"
echo
echo '=== apisix jwt session+prompt ==='
sid=$(curl -sf https://wab.flyfishphp.cn/kilo/session -H "Authorization: Bearer $tok" \
  -H 'Content-Type: application/json' -d '{"title":"jwt-diag"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo session=$sid
curl -s -w '\nHTTP:%{http_code}\n' -X POST "https://wab.flyfishphp.cn/kilo/session/$sid/prompt_async" \
  -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"reply OK only"}],"agent":"ask"}'
echo
sleep 8
curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/message" -H "Authorization: Bearer $tok" \
  | python3 -c "
import sys,json
for m in json.load(sys.stdin):
    role=m.get('info',{}).get('role')
    texts=[p.get('text','')[:40] for p in m.get('parts',[]) if p.get('type')=='text']
    print(role, texts)
"
echo '=== sse first event (5s) ==='
timeout 5 curl -sN https://wab.flyfishphp.cn/kilo/event -H "Authorization: Bearer $tok" | head -c 600 || true
echo
"""

_, stdout, stderr = client.exec_command(cmd, timeout=120)
print(stdout.read().decode()[:6000])
if stderr.read().decode():
    print("stderr", stderr.read().decode()[:500])
client.close()
