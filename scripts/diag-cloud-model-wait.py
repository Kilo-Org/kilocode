#!/usr/bin/env python3
import os
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("43.143.227.210", username="root", password=os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#"), timeout=15)

script = r"""#!/bin/bash
set -e
cd /root/kilocode-main/deploy/enterprise
tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token -H 'Content-Type: application/json' -d '{"email":"admin@enterprise.local"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

test_model() {
  label=$1
  body=$2
  sid=$(curl -sf https://wab.flyfishphp.cn/kilo/session -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "{\"title\":\"$label\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "=== $label session=$sid ==="
  curl -s -w ' prompt_http=%{http_code}\n' -o /dev/null -X POST "https://wab.flyfishphp.cn/kilo/session/$sid/prompt_async" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$body"
  for i in 5 10 15 20 25 30; do
    sleep 5
    n=$(curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/message" -H "Authorization: Bearer $tok" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
    echo "  t+${i}s messages=$n"
    if [ "$n" -ge 2 ]; then break; fi
  done
  curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/message" -H "Authorization: Bearer $tok" | python3 <<'PY'
import sys,json
for m in json.load(sys.stdin):
 info=m.get('info',{})
 print(' ', info.get('role'), 'error=', info.get('error'))
 for p in m.get('parts',[]):
  if p.get('type')=='text':
   print('   text:', (p.get('text') or '')[:100])
PY
  echo "  status:" $(curl -s "https://wab.flyfishphp.cn/kilo/session/$sid/status" -H "Authorization: Bearer $tok")
  echo
}

test_model good '{"parts":[{"type":"text","text":"说OK"}],"model":{"providerID":"deepseek","modelID":"deepseek-v4-pro"},"agent":"ask"}'
test_model bad '{"parts":[{"type":"text","text":"说OK"}],"model":{"providerID":"ruiyumaas","modelID":"glm-5.1"},"agent":"ask"}'
test_model default '{"parts":[{"type":"text","text":"说OK"}],"agent":"ask"}'
"""

sftp = client.open_sftp()
with sftp.file("/tmp/diag-model.sh", "w") as f:
    f.write(script)
sftp.close()
_, stdout, stderr = client.exec_command("bash /tmp/diag-model.sh", timeout=180)
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print("stderr:", err)
client.close()
