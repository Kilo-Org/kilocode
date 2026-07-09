#!/usr/bin/env python3
"""Upload kilocode-cloud.tgz and rebuild enterprise-platform on cloud."""
import os
import sys
import time

import paramiko

HOST = os.environ.get("SSH_HOST", "43.143.227.210")
USER = os.environ.get("SSH_USER", "root")
PWD = os.environ.get("SSH_PASSWORD", "fcb326XYZ0!@#")
ROOT = os.environ.get("CLOUD_ROOT", "/root/kilocode-main")
TAR_LOCAL = os.environ.get(
    "CLOUD_TAR",
    os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "kilocode-cloud.tgz")),
)
TAR_REMOTE = "/root/kilocode-cloud.tgz"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 3600) -> tuple[int, str, str]:
    print(f"\n>>> {cmd[:120]}...")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        sys.stdout.buffer.write(out.encode("utf-8", errors="replace"))
        sys.stdout.buffer.write(b"\n")
    if err.strip():
        sys.stderr.buffer.write(err.encode("utf-8", errors="replace"))
        sys.stderr.buffer.write(b"\n")
    return code, out, err


def main() -> int:
    upload = "--upload" in sys.argv or len(sys.argv) == 1
    build = "--build" in sys.argv or len(sys.argv) == 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[cloud] connect {USER}@{HOST}")
    client.connect(HOST, username=USER, password=PWD, timeout=30)

    if upload:
        if not os.path.isfile(TAR_LOCAL):
            print(f"[cloud] missing {TAR_LOCAL} — run pack-for-cloud.ps1 first", file=sys.stderr)
            return 1
        print(f"[cloud] upload {TAR_LOCAL}")
        sftp = client.open_sftp()
        t0 = time.time()
        sftp.put(TAR_LOCAL, TAR_REMOTE)
        sftp.close()
        mb = os.path.getsize(TAR_LOCAL) / 1024 / 1024
        print(f"[cloud] uploaded {mb:.1f} MB in {time.time() - t0:.0f}s")
        code, _, _ = run(
            client,
            f"mkdir -p {ROOT} && tar -xzf {TAR_REMOTE} -C {ROOT} && rm -f {TAR_REMOTE}",
            timeout=300,
        )
        if code != 0:
            return code

    if build:
        code, _, _ = run(
            client,
            f"cd {ROOT}/deploy/enterprise && chmod +x scripts/*.sh 2>/dev/null; "
            f"docker compose --profile platform build enterprise-platform",
            timeout=3600,
        )
        if code != 0:
            return code
        code, _, _ = run(
            client,
            f"cd {ROOT}/deploy/enterprise && "
            f"docker compose --profile platform up -d --force-recreate enterprise-platform",
            timeout=300,
        )
        if code != 0:
            return code

    run(client, "sleep 2 && curl -sf http://127.0.0.1:8090/health", timeout=30)
    run(client, "curl -s -o /dev/null -w 'admin %{http_code}\\n' http://127.0.0.1:8090/admin/", timeout=30)
    run(
        client,
        "curl -sk -o /dev/null -w 'public admin %{http_code}\\n' https://wab.flyfishphp.cn/admin/ || true",
        timeout=30,
    )
    client.close()
    print("[cloud] done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
