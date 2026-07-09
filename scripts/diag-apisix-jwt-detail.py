#!/usr/bin/env python3
import os

import paramiko

pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("43.143.227.210", username="root", password=pwd, timeout=15)

cmds = [
    "docker exec enterprise-apisix-1 grep -A2 'jwt-auth' /usr/local/apisix/conf/apisix.yaml | head -6",
    "ls -la /www/server/panel/vhost/nginx/proxy/wab.flyfishphp.cn/ 2>/dev/null",
    "cat /www/server/panel/vhost/nginx/proxy/wab.flyfishphp.cn/*.conf 2>/dev/null",
    """cd /root/kilocode-main/deploy/enterprise && tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token -H 'Content-Type: application/json' -d '{"email":"admin@enterprise.local"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])") && echo "$tok" | awk -F. '{print $2}' | python3 -c "import sys,base64,json; b=sys.stdin.read().strip(); b+=('='*((4-len(b)%4)%4)); print(json.dumps(json.loads(base64.urlsafe_b64decode(b)),indent=2))" && curl -sv http://127.0.0.1:9080/kilo/global/health -H "Authorization: Bearer $tok" 2>&1 | tail -20""",
]
for c in cmds:
    print(">>>", c[:120])
    _, o, e = client.exec_command(c, timeout=30)
    print(o.read().decode() or e.read().decode())
    print()
client.close()
