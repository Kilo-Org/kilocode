#!/usr/bin/env python3
import os
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("43.143.227.210", username="root", password=os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#"), timeout=15)

body = '{"parts":[{"type":"text","text":"hi"}],"model":{"providerID":"ruiyumaas","modelID":"glm-5.1"},"agent":"ask"}'
cmd = f"""
cd /root/kilocode-main/deploy/enterprise
tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token -H 'Content-Type: application/json' -d '{{"email":"admin@enterprise.local"}}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
sid=$(curl -sf https://wab.flyfishphp.cn/kilo/session -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{{"title":"bad"}}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo session=$sid
curl -s -w 'http=%{{http_code}}\\n' -o /dev/null -X POST "https://wab.flyfishphp.cn/kilo/session/$sid/prompt_async" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{body}'
sleep 20
curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/message" -H "Authorization: Bearer $tok" > /tmp/msgs.json
python3 -c "import json; m=json.load(open('/tmp/msgs.json')); print('count',len(m));
[print(x.get('info',{{}}).get('role'),x.get('info',{{}}).get('error')) for x in m]"
curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/status" -H "Authorization: Bearer $tok"
echo
"""
_, stdout, stderr = client.exec_command(cmd, timeout=90)
print(stdout.read().decode())
if stderr.read().decode():
    print("stderr", stderr.read().decode())
client.close()
