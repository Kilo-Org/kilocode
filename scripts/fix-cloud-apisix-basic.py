#!/usr/bin/env python3
"""Sync APISIX jwt secret + engine Basic header from .env, then probe JWT /kilo health."""
import os
import time

import paramiko

HOST = os.environ.get("SSH_HOST", "43.143.227.210")
PWD = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
DIR = "/root/kilocode-main/deploy/enterprise"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> str:
    print(f">>> {cmd[:140]}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("ERR:", err.rstrip())
    return out


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PWD, timeout=20)

    run(client, f"cd {DIR} && chmod +x scripts/sync-apisix-from-env.sh && ./scripts/sync-apisix-from-env.sh")
    time.sleep(4)
    run(client, f"grep Authorization {DIR}/apisix/apisix.yaml | head -3")
    run(
        client,
        f"cd {DIR} && PLATFORM_URL=http://127.0.0.1:8090 GATEWAY_URL=http://127.0.0.1:9080 ./scripts/smoke-phase2-sso.sh",
    )
    run(
        client,
        f"cd {DIR} && PLATFORM_URL=http://127.0.0.1:8090 GATEWAY_URL=https://wab.flyfishphp.cn ./scripts/smoke-phase2-sso.sh",
    )
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
