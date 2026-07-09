#!/usr/bin/env python3
"""Patch cloud docker-compose and recreate enterprise-platform."""
import os
import time

import paramiko

host = os.environ.get("SSH_HOST", "43.143.227.210")
user = os.environ.get("SSH_USER", "root")
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
compose = "/root/kilocode-main/deploy/enterprise/docker-compose.yml"
line = "      PLATFORM_OIDC_VSCODE_URI: ${PLATFORM_OIDC_VSCODE_URI:-vscode://yoyo-local.yoyo-code/enterprise/callback}"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=pwd, timeout=15)

def run(cmd: str, wait: int = 120) -> str:
    print(">>>", cmd[:120])
    _, stdout, stderr = client.exec_command(cmd, timeout=wait)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out.rstrip())
    if err:
        print("ERR:", err.rstrip())
    return out + err

run(f"grep -q 'PLATFORM_OIDC_VSCODE_URI' {compose} || sed -i '/PLATFORM_OIDC_BROWSER_REDIRECT/a\\      PLATFORM_OIDC_VSCODE_URI: ${{PLATFORM_OIDC_VSCODE_URI:-vscode://yoyo-local.yoyo-code/enterprise/callback}}' {compose}")
run(f"grep -n 'PLATFORM_OIDC' {compose}")
run("cd /root/kilocode-main/deploy/enterprise && docker compose --profile platform up -d --build enterprise-platform", wait=300)
time.sleep(3)
run("cd /root/kilocode-main/deploy/enterprise && docker compose --profile platform exec -T enterprise-platform env | grep PLATFORM_OIDC | sort")
run("curl -s https://wab.flyfishphp.cn/api/v1/auth/status")
client.close()
print("done")
