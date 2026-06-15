import os
import select
import socketserver
import sys
import threading

import paramiko

HOST = os.environ.get("SSH_HOST", "43.143.227.210")
USER = os.environ.get("SSH_USER", "root")
PASSWORD = os.environ.get("SSH_PASSWORD", "")
LOCAL = int(os.environ.get("TUNNEL_LOCAL_PORT", "9080"))
REMOTE = ("127.0.0.1", 9080)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        transport = self.server.transport
        chan = transport.open_channel("direct-tcpip", REMOTE, self.request.getpeername())
        if not chan:
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
    if not PASSWORD:
        print("Set SSH_PASSWORD env var", file=sys.stderr)
        sys.exit(1)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15, look_for_keys=False, allow_agent=False)
    transport = client.get_transport()
    server = ForwardServer(("127.0.0.1", LOCAL), Handler)
    server.transport = transport
    print(f"SSH tunnel 127.0.0.1:{LOCAL} -> {HOST}:{REMOTE[1]} (Ctrl+C to stop)")
    server.serve_forever()


if __name__ == "__main__":
    main()
