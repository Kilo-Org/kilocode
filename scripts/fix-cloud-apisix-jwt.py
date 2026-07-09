#!/usr/bin/env python3
import os
import re
import time

import paramiko

host = "43.143.227.210"
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
dir = "/root/kilocode-main/deploy/enterprise"
apisix = f"{dir}/apisix/apisix.yaml"
envfile = f"{dir}/.env"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=pwd, timeout=15)

def run(cmd: str, wait: int = 120) -> str:
    print(">>>", cmd[:140])
    _, stdout, stderr = client.exec_command(cmd, timeout=wait)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out.rstrip())
    if err:
        print("ERR:", err.rstrip())
    return out + err

secret = ""
_, o, _ = client.exec_command(f"grep '^PLATFORM_JWT_SECRET=' {envfile} | head -1")
line = o.read().decode().strip()
if line:
    secret = line.split("=", 1)[1].strip()
if not secret:
    raise SystemExit("PLATFORM_JWT_SECRET not found in .env")

run(
    f"python3 - <<'PY'\n"
    f"import re\n"
    f"from pathlib import Path\n"
    f"p = Path('{apisix}')\n"
    f"text = p.read_text()\n"
    f"new = re.sub(r'(secret: ).*', r'\\1{secret}', text, count=1)\n"
    f"p.write_text(new)\n"
    f"print('patched apisix secret')\n"
    f"PY"
)
run(f"grep -n 'secret:' {apisix} | head -3")
run(f"cd {dir} && docker compose --profile gateway restart apisix")
time.sleep(3)
run(
    f"cd {dir} && tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token "
    f"-H 'Content-Type: application/json' -d '{{\"email\":\"admin@enterprise.local\"}}' "
    f"| sed -n 's/.*\"accessToken\":\"\\([^\"]*\\)\".*/\\1/p') && "
    f"echo token_len=${{#tok}} && "
    f"curl -s -o /dev/null -w 'local_jwt_health:%{{http_code}}\\n' http://127.0.0.1:9080/kilo/global/health -H \"Authorization: Bearer $tok\" && "
    f"curl -s -o /dev/null -w 'public_jwt_health:%{{http_code}}\\n' https://wab.flyfishphp.cn/kilo/global/health -H \"Authorization: Bearer $tok\""
)
client.close()
print("done")
