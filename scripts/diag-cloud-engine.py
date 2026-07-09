#!/usr/bin/env python3
import os
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
        print("ERR:", err.rstrip()[:3000])
    print("---")
    return out


run(
    "grep -E 'KILO_CUSTOM_API_KEY|KILO_SERVER_PASSWORD|KILO_ENGINE' "
    + f"{dir}/.env | sed 's/KILO_CUSTOM_API_KEY=.*/KILO_CUSTOM_API_KEY=***masked***/'"
)
run(f"cd {dir} && docker compose ps --format '{{{{.Name}}}} {{{{.Status}}}}'")
run(f"cd {dir} && docker compose logs kilo-engine --tail 100 2>&1")
run(
    f"cd {dir} && docker compose exec -T kilo-engine sh -c "
    "'ls -la /root/.config/kilo/ 2>/dev/null; "
    "test -f /root/.config/kilo/kilo.jsonc && head -40 /root/.config/kilo/kilo.jsonc; "
    "test -f /root/.config/kilo/opencode.json && head -40 /root/.config/kilo/opencode.json'"
)
run(
    f"cd {dir} && tok=$(curl -sf -X POST http://127.0.0.1:8090/api/v1/auth/dev-token "
    "-H 'Content-Type: application/json' -d '{{\"email\":\"admin@enterprise.local\"}}' "
    "| python3 -c \"import sys,json; print(json.load(sys.stdin)['accessToken'])\") && "
    "curl -sf http://127.0.0.1:9080/kilo/config -H \"Authorization: Bearer $tok\" "
    "| python3 -c \"import sys,json; c=json.load(sys.stdin); print('model',c.get('model')); "
    "print('providers',c.get('enabled_providers')); print('disabled',c.get('disabled_providers'))\""
)
client.close()
