#!/usr/bin/env python3
"""Upload Phase A assessment files to cloud (upload only, no build)."""
import os

import paramiko

host = os.environ.get("SSH_HOST", "43.143.227.210")
user = os.environ.get("SSH_USER", "root")
pwd = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
remote_root = "/root/kilocode-main"

files = [
    "deploy/enterprise/platform/internal/usage/assessment.go",
    "deploy/enterprise/platform/internal/usage/assessment_test.go",
    "deploy/enterprise/platform/cmd/server/main.go",
    "deploy/enterprise/platform/admin-ui/src/pages/Usage/Assessment.tsx",
    "deploy/enterprise/platform/admin-ui/src/pages/Usage/index.tsx",
    "deploy/enterprise/platform/admin-ui/src/services/enterprise.ts",
    "docs/enterprise/P2-ASSESSMENT-CHANGES.md",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=pwd, timeout=20)
sftp = client.open_sftp()

for rel in files:
    local = os.path.join(root, rel.replace("/", os.sep))
    remote = f"{remote_root}/{rel}"
    if not os.path.isfile(local):
        print(f"MISSING local: {local}")
        continue
    rdir = os.path.dirname(remote)
    client.exec_command(f'mkdir -p "{rdir}"')
    print(f"upload {rel} -> {remote}")
    sftp.put(local, remote)

sftp.close()
client.close()
print("done")
