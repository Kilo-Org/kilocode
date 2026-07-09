#!/usr/bin/env python3
import os
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("43.143.227.210", username="root", password=os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#"), timeout=15)
cmd = r"""
cd /root/kilocode-main/deploy/enterprise
tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token -H 'Content-Type: application/json' -d '{"email":"admin@enterprise.local"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
sid=$(curl -sf https://wab.flyfishphp.cn/kilo/session -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{"title":"bad-model"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
code=$(curl -s -o /tmp/bad.txt -w '%{http_code}' -X POST "https://wab.flyfishphp.cn/kilo/session/$sid/prompt_async" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{"parts":[{"type":"text","text":"hi"}],"model":{"providerID":"ruiyumaas","modelID":"glm-5.1"},"agent":"ask"}')
echo bad_model_http=$code
head -c 400 /tmp/bad.txt; echo
sleep 6
curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/message" -H "Authorization: Bearer $tok" | python3 -c "import sys,json
for m in json.load(sys.stdin):
 print(m.get('info',{}).get('role'), m.get('info',{}).get('error'))"
"""
_, stdout, _ = client.exec_command(cmd, timeout=90)
print(stdout.read().decode())
client.close()
