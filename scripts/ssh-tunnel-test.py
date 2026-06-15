import base64
import json
import select
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.request

import paramiko

import os

HOST = os.environ.get("SSH_HOST", "43.143.227.210")
USER = os.environ.get("SSH_USER", "root")
PASSWORD = os.environ.get("SSH_PASSWORD", "")
LOCAL = 9080
REMOTE = ("127.0.0.1", 9080)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        transport = self.server.transport
        try:
            chan = transport.open_channel("direct-tcpip", REMOTE, self.request.getpeername())
        except Exception as err:
            print(f"channel open failed: {err}", file=sys.stderr)
            return
        if chan is None:
            return
        while True:
            read, _, _ = select.select([self.request, chan], [], [])
            if self.request in read:
                data = self.request.recv(1024)
                if not data:
                    break
                chan.send(data)
            if chan in read:
                data = chan.recv(1024)
                if not data:
                    break
                self.request.send(data)
        chan.close()
        self.request.close()


class ForwardServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"SSH connect {USER}@{HOST} ...")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15, look_for_keys=False, allow_agent=False)
    transport = client.get_transport()
    server = ForwardServer(("127.0.0.1", LOCAL), Handler)
    server.transport = transport
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Tunnel OK 127.0.0.1:{LOCAL} -> {REMOTE[0]}:{REMOTE[1]}")
    time.sleep(1)

    pair = base64.b64encode(b"kilo:abc12345").decode()
    health = urllib.request.Request(
        f"http://127.0.0.1:{LOCAL}/kilo/global/health",
        headers={"Authorization": f"Basic {pair}"},
    )
    with urllib.request.urlopen(health, timeout=10) as resp:
        print(f"Health {resp.status}: {resp.read().decode()}")

    lic = urllib.request.Request(
        f"http://127.0.0.1:{LOCAL}/api/v1/license/verify",
        data=json.dumps({"key": "poc-demo-key", "machineId": "test", "client": "vscode"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(lic, timeout=10) as resp:
        print(f"License {resp.status}: {resp.read().decode()}")

    print("PASS")
    server.shutdown()
    client.close()


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as err:
        print(f"HTTP FAIL: {err}", file=sys.stderr)
        sys.exit(1)
    except paramiko.AuthenticationException:
        print("SSH auth failed — check root password", file=sys.stderr)
        sys.exit(2)
    except Exception as err:
        print(f"FAIL: {err}", file=sys.stderr)
        sys.exit(3)
