#!/usr/bin/env python3
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("43.143.227.210", username="root", password="fcb326XYZ0!@#", timeout=15)
_, o, _ = c.exec_command("sed -n '80,180p' /root/kilocode-main/deploy/enterprise/platform/internal/oidc/oidc.go")
print(o.read().decode())
_, o, _ = c.exec_command("sed -n '290,395p' /root/kilocode-main/deploy/enterprise/platform/internal/oidc/oidc.go")
print(o.read().decode())
c.close()
