#!/usr/bin/env python3
import os
import time

import paramiko

host = os.environ.get("SSH_HOST", "43.143.227.210")
user = os.environ.get("SSH_USER", "root")
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
remote_base = "/root/kilocode-main/deploy/enterprise/platform"
files = [
    ("deploy/enterprise/platform/internal/oidc/oidc.go", f"{remote_base}/internal/oidc/oidc.go"),
    ("deploy/enterprise/platform/cmd/server/main.go", f"{remote_base}/cmd/server/main.go"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=pwd, timeout=15)
sftp = client.open_sftp()
for local_rel, remote in files:
    local = os.path.join(root, local_rel.replace("/", os.sep))
    print(f"upload {local} -> {remote}")
    sftp.put(local, remote)
sftp.close()

def run(cmd: str, wait: int = 300) -> None:
    print(">>>", cmd[:140])
    _, stdout, stderr = client.exec_command(cmd, timeout=wait)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err:
        print("ERR:", err)

run(
    "cd /root/kilocode-main/deploy/enterprise && docker compose --profile platform build --no-cache enterprise-platform && docker compose --profile platform up -d enterprise-platform",
    wait=600,
)
time.sleep(2)
run("cd /root/kilocode-main/deploy/enterprise && docker compose --profile platform exec -T enterprise-platform sh -c 'strings /usr/local/bin/enterprise-platform | grep writeVscode | head -3'")
run("curl -sI 'https://wab.flyfishphp.cn/api/v1/auth/login?client=vscode' | head -5")
client.close()
print("done")
