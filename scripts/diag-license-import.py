#!/usr/bin/env python3
import json
import os
import paramiko

HOST = os.environ.get("SSH_HOST", "43.143.227.210")
USER = os.environ.get("SSH_USER", "root")
PWD = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
ROOT = "/root/kilocode-main/deploy/enterprise"


def run(client, cmd, timeout=120):
    print(f"\n>>> {cmd}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("STDERR:", err.rstrip())
    return code, out, err


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PWD, timeout=30)

    run(client, f"grep LICENSE {ROOT}/.env || true")
    run(
        client,
        f"cd {ROOT} && docker compose --profile platform ps enterprise-platform",
    )
    run(
        client,
        f"cd {ROOT} && docker compose --profile platform exec -T enterprise-platform "
        f"sh -c 'printenv PLATFORM_LICENSE_PUBLIC_KEY_PATH; "
        f"ls -la /samples/license-dev-public.pem'",
    )

    _, token_out, _ = run(
        client,
        "curl -s -X POST http://127.0.0.1:8090/api/v1/auth/dev-token "
        "-H 'Content-Type: application/json' "
        "-d '{\"email\":\"admin@enterprise.local\"}'",
    )
    token = ""
    try:
        token = json.loads(token_out).get("accessToken", "")
    except json.JSONDecodeError:
        pass
    print(f"\n[token] len={len(token)}")

    tenant = "00000000-0000-0000-0000-000000000001"
    if token:
        run(
            client,
            f"curl -s -w '\\nHTTP %{{http_code}}\\n' "
            f"-X POST http://127.0.0.1:8090/api/v1/tenants/{tenant}/licenses "
            f"-H 'Authorization: Bearer {token}' "
            f"-H 'Content-Type: application/json' "
            f"-d @/tmp/offline-license.signed.json",
        )
        run(
            client,
            f"curl -s -w '\\nHTTP %{{http_code}}\\n' "
            f"-X POST https://wab.flyfishphp.cn/api/v1/tenants/{tenant}/licenses "
            f"-H 'Authorization: Bearer {token}' "
            f"-H 'Content-Type: application/json' "
            f"-d @/tmp/offline-license.signed.json",
        )

    run(client, f"cd {ROOT} && docker compose --profile platform logs enterprise-platform --tail 30")
    client.close()


if __name__ == "__main__":
    main()
