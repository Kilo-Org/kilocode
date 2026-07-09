#!/usr/bin/env python3
import os
import time

import paramiko

host = "43.143.227.210"
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
dir = "/root/kilocode-main/deploy/enterprise"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=pwd, timeout=15)

def run(cmd: str, wait: int = 120) -> str:
    print(">>>", cmd[:160])
    _, stdout, stderr = client.exec_command(cmd, timeout=wait)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out.rstrip())
    if err:
        print("ERR:", err.rstrip())
    return out

run(f"secret=$(grep '^PLATFORM_JWT_SECRET=' {dir}/.env | cut -d= -f2-) && sed -i \"0,/secret: /s|secret: .*|secret: $secret|\" {dir}/apisix/apisix.yaml && grep 'secret:' {dir}/apisix/apisix.yaml | head -1")
run(f"cd {dir} && docker compose --profile gateway restart apisix")
time.sleep(3)
run(
    f"cd {dir} && tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token "
    "-H 'Content-Type: application/json' -d '{\"email\":\"admin@enterprise.local\"}' "
    "| python3 -c \"import sys,json; print(json.load(sys.stdin)['accessToken'])\") && "
    "curl -s -o /dev/null -w 'local_jwt:%{http_code}\\n' http://127.0.0.1:9080/kilo/global/health -H \"Authorization: Bearer $tok\" && "
    "curl -s -o /dev/null -w 'public_jwt:%{http_code}\\n' https://wab.flyfishphp.cn/kilo/global/health -H \"Authorization: Bearer $tok\" && "
    "curl -s -o /dev/null -w 'public_basic:%{http_code}\\n' https://wab.flyfishphp.cn/kilo/global/health -u kilo:abc12345"
)
run("grep -r 'kilo\\|9080\\|8090' /www/server/panel/vhost/nginx/wab.flyfishphp.cn.conf 2>/dev/null | head -20 || find /www/server/panel/vhost -name '*wab*' 2>/dev/null | head -5")
run("cat /www/server/panel/vhost/nginx/wab.flyfishphp.cn.conf 2>/dev/null | head -80")
client.close()
