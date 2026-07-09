#!/usr/bin/env python3
import os
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("43.143.227.210", username="root", password=os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#"), timeout=15)

cmd = r"""
cd /root/kilocode-main/deploy/enterprise
tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token -H 'Content-Type: application/json' -d '{"email":"admin@enterprise.local"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
echo '=== providers ==='
curl -s https://wab.flyfishphp.cn/kilo/provider -H "Authorization: Bearer $tok" | python3 -c "import sys,json; d=json.load(sys.stdin);
[print(k, list((d[k].get('models') or {}).keys())[:5]) for k in sorted(d.keys())]"
echo '=== config model ==='
curl -s https://wab.flyfishphp.cn/kilo/config -H "Authorization: Bearer $tok" | python3 -c "import sys,json; c=json.load(sys.stdin); print('model',c.get('model')); print('small',c.get('small_model')); print('disabled',c.get('disabled_providers'))"
"""
_, stdout, _ = client.exec_command(cmd, timeout=60)
print(stdout.read().decode())
client.close()
