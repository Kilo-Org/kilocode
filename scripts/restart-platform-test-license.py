#!/usr/bin/env python3
import json
import os
import paramiko

HOST = os.environ.get("SSH_HOST", "43.143.227.210")
USER = os.environ.get("SSH_USER", "root")
PWD = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
ROOT = "/root/kilocode-main/deploy/enterprise"
TENANT = "00000000-0000-0000-0000-000000000001"


def run(client, cmd, timeout=180):
    print(f"\n>>> {cmd}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip())
    return out


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PWD, timeout=30)

    run(
        client,
        f"cd {ROOT} && docker compose --profile platform up -d --force-recreate enterprise-platform",
    )
    run(client, "sleep 3")
    tok_out = run(
        client,
        "curl -s -X POST http://127.0.0.1:8090/api/v1/auth/dev-token "
        "-H 'Content-Type: application/json' "
        "-d '{\"email\":\"admin@enterprise.local\"}'",
    )
    token = json.loads(tok_out).get("accessToken", "")
    run(
        client,
        f"curl -s -w '\\nHTTP %{{http_code}}\\n' "
        f"-X POST http://127.0.0.1:8090/api/v1/tenants/{TENANT}/licenses "
        f"-H 'Authorization: Bearer {token}' "
        f"-H 'Content-Type: application/json' "
        f"-d @/tmp/offline-license.signed.json",
    )
    client.close()


if __name__ == "__main__":
    main()
