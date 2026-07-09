#!/usr/bin/env python3
import os
import time
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("43.143.227.210", username="root", password=os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#"), timeout=15)

def run(label, model):
    cmd = f"""
cd /root/kilocode-main/deploy/enterprise
tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token -H 'Content-Type: application/json' -d '{{"email":"admin@enterprise.local"}}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
sid=$(curl -sf https://wab.flyfishphp.cn/kilo/session -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{{"title":"{label}"}}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
code=$(curl -s -o /tmp/p.txt -w '%{{http_code}}' -X POST "https://wab.flyfishphp.cn/kilo/session/$sid/prompt_async" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{{"parts":[{{"type":"text","text":"说OK"}}],"model":{model},"agent":"ask"}}')
echo prompt_http=$code
sleep 15
curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/message" -H "Authorization: Bearer $tok" | python3 -c "import sys,json
msgs=json.load(sys.stdin)
print('count', len(msgs))
for m in msgs:
 info=m.get('info',{{}})
 print(info.get('role'), info.get('error'))
 for p in m.get('parts',[]):
  if p.get('type')=='text':
   print(' text', (p.get('text') or '')[:120])
curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/status" -H "Authorization: Bearer $tok"
"""
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(f"=== {label} ===")
    print(out)
    if err:
        print("stderr:", err)

run("good-deepseek", '{"providerID":"deepseek","modelID":"deepseek-v4-pro"}')
run("bad-ruiyumaas", '{"providerID":"ruiyumaas","modelID":"glm-5.1"}')
client.close()
