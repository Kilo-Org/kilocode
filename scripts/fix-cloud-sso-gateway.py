#!/usr/bin/env python3
"""Apply SSO gateway fixes on cloud: APISIX jwt+basic + nginx /kilo route."""
import base64
import os
import re
import time

import paramiko

host = "43.143.227.210"
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dir = "/root/kilocode-main/deploy/enterprise"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=pwd, timeout=15)
sftp = client.open_sftp()

uploads = [
    ("deploy/enterprise/apisix/apisix.yaml", f"{dir}/apisix/apisix.yaml"),
    ("deploy/enterprise/scripts/sync-apisix-from-env.sh", f"{dir}/scripts/sync-apisix-from-env.sh"),
    ("deploy/enterprise/nginx/wab.kilo-location.conf", f"{dir}/nginx/wab.kilo-location.conf"),
]
for local_rel, remote in uploads:
    sftp.put(os.path.join(root, local_rel.replace("/", os.sep)), remote)
sftp.close()

def run(cmd: str, wait: int = 180) -> None:
    print(">>>", cmd[:160])
    _, stdout, stderr = client.exec_command(cmd, timeout=wait)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out.rstrip())
    if err:
        print("ERR:", err.rstrip())

run(f"chmod +x {dir}/scripts/sync-apisix-from-env.sh")
run(f"cd {dir} && ./scripts/sync-apisix-from-env.sh")

# nginx: add /kilo location if missing
run(
    f"""proxy_dir=/www/server/panel/vhost/nginx/proxy/wab.flyfishphp.cn
kilo_conf="$proxy_dir/kilo-apisix.conf"
if [[ ! -f "$kilo_conf" ]]; then
  cp {dir}/nginx/wab.kilo-location.conf "$kilo_conf"
  nginx -t && nginx -s reload
  echo "nginx kilo route added"
else
  echo "nginx kilo route exists"
fi"""
)

time.sleep(2)
run(
    f"""cd {dir} && tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token -H 'Content-Type: application/json' -d '{{"email":"admin@enterprise.local"}}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])") && \
curl -s -o /dev/null -w 'local_jwt:%{{http_code}}\\n' http://127.0.0.1:9080/kilo/global/health -H "Authorization: Bearer $tok" && \
curl -s -o /dev/null -w 'public_jwt:%{{http_code}}\\n' https://wab.flyfishphp.cn/kilo/global/health -H "Authorization: Bearer $tok" """
)
client.close()
print("done")
