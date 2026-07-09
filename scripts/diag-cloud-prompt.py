#!/usr/bin/env python3
import os
import paramiko

host = "43.143.227.210"
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
dir = "/root/kilocode-main/deploy/enterprise"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=pwd, timeout=15)


def run(cmd: str) -> None:
    print(">>>", cmd[:200])
    _, stdout, stderr = client.exec_command(cmd, timeout=180)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out.rstrip()[:5000])
    if err:
        print("ERR:", err.rstrip()[:3000])
    print("---")


run(
    f"cd {dir} && python3 - <<'PY'\n"
    "from pathlib import Path\n"
    "for line in Path('.env').read_text().splitlines():\n"
    "    if line.startswith('KILO_CUSTOM_API_KEY='):\n"
    "        v=line.split('=',1)[1].strip()\n"
    "        print('api_key_len', len(v), 'empty', not v or v in ('\"\"', \"''\"))\n"
    "PY"
)
run(
    f"cd {dir} && docker compose exec -T kilo-engine sh -c "
    "'echo KILO_CUSTOM_API_KEY_len=${#KILO_CUSTOM_API_KEY}; echo KILO_SERVER_PASSWORD_set=${KILO_SERVER_PASSWORD:+yes}'"
)
run(
    f"cd {dir} && tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token "
    "-H 'Content-Type: application/json' -d '{{\"email\":\"admin@enterprise.local\"}}' "
    "| python3 -c \"import sys,json; print(json.load(sys.stdin)['accessToken'])\") && "
    "curl -s -w '\\nHTTP:%{{http_code}}\\n' http://127.0.0.1:9080/kilo/global/health -H \"Authorization: Bearer $tok\""
)
run(
    f"cd {dir} && tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token "
    "-H 'Content-Type: application/json' -d '{{\"email\":\"admin@enterprise.local\"}}' "
    "| python3 -c \"import sys,json; print(json.load(sys.stdin)['accessToken'])\") && "
    "curl -s -w '\\nHTTP:%{{http_code}}\\n' -X POST http://127.0.0.1:9080/kilo/session "
    "-H 'Authorization: Bearer $tok' -H 'Content-Type: application/json' "
    "-d '{{\"title\":\"diag\"}}' | head -c 800"
)
run(
    f"cd {dir} && docker compose logs kilo-engine --since 30m 2>&1 | tail -50"
)
client.close()
