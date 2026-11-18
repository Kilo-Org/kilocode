"""POSIX first-launch benchmark. Pass a built kilo2 binary; --submission uses a loopback model.

python3 packages/kilo-cli/script/prompt-startup.py packages/kilo-cli/dist/cli-darwin-arm64/bin/kilo2
Each trial uses an empty project and isolated profile. With --service running, the service is already healthy
but has not opened the project. Timings include the dev isolation wrapper, not managed-service setup commands.
"""

import argparse
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import socket
import statistics
import struct
import subprocess
import tempfile
import termios
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread


@contextmanager
def local_model():
    """A completed chat stream, verified in the transcript, rather than just an accepted HTTP request."""
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            self.send_error(404)

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            # Auxiliary requests (such as title generation) must not count as the submitted turn.
            answer = "FixtureReplyOK" if body.get("tools") and any(
                msg.get("role") == "user" and "startup-probe" in str(msg.get("content"))
                for msg in body["messages"]
            ) else "Fixture title"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for delta, stop in [({"role": "assistant", "content": answer}, None), ({}, "stop")]:
                data = {"id": "probe", "object": "chat.completion.chunk", "model": body["model"],
                        "choices": [{"index": 0, "delta": delta, "finish_reason": stop}]}
                self.wfile.write(("data: " + json.dumps(data) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()


def trial(binary, background, pi=False, model=None, service="private", timing=None, edit=False):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project = root / "project"
        project.mkdir()
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        # A tty driver's local echo is not evidence that the prompt accepted a key.
        attrs = termios.tcgetattr(slave)
        attrs[3] &= ~termios.ECHO
        termios.tcsetattr(slave, termios.TCSANOW, attrs)
        env = dict(PATH=os.environ["PATH"], HOME=tmp, SHELL="/bin/sh", LANG="en_US.UTF-8", TERM="xterm-256color",
                   KILO_V2_TEST_BINARY=str(binary), KILO_V2_PROFILE=str(root / "profile"), KILO_DISABLE_MODELS_FETCH="1")
        if timing is not None:
            env["KILO_V2_TIME_EXEC"] = "1"
        repo = Path(__file__).resolve().parents[3]
        command = [str(binary)] if pi else ["bun", "dev", *(["--standalone"] if service == "private" else []), str(project)]
        if model:
            env.update(KILO_API_URL=model, KILO_AI_GATEWAY_URL=model + "/v1", OPENCODE_CONFIG_CONTENT=json.dumps({
                "model": "local/echo", "providers": {"local": {"name": "Local", "package": "@opencode/ai/providers/openai-compatible",
                    "settings": {"baseURL": model + "/v1", "apiKey": "fixture"},
                    "models": {"echo": {"name": "Echo", "limit": {"context": 32000, "output": 4000}}}}}}))
            if not edit:
                command.extend(["--prompt", "startup-probe"])
        if not pi and service != "private":
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            for args in ([["set", "port", str(port)], ["start"]] if service == "running" else [["set", "port", str(port)]]):
                subprocess.run(["bun", "dev", "service", *args], cwd=repo, env=env, capture_output=True, check=True, timeout=30)
        start = time.monotonic()
        def elapsed():
            end = time.monotonic_ns()
            wrapped = round(end / 1e6 - start * 1000)
            if timing is None:
                return wrapped
            timing.append(wrapped)
            if pi:
                return wrapped  # Pi was spawned directly.
            # Older macOS Python builds use a process-relative epoch for monotonic(). Validate the shared wall clock
            # interval against the enclosing monotonic interval so a clock adjustment cannot improve the result.
            marker = re.search(rb"kilo-test-exec-ms=(\d+)", output)
            if not marker:
                raise RuntimeError("Missing executable spawn timestamp")
            native = round(time.time_ns() / 1e6 - int(marker[1]))
            if not 0 < native <= wrapped + 1:
                raise RuntimeError("Executable timestamp outside launch interval")
            return native
        proc = subprocess.Popen(command, cwd=project if pi else repo,
                                env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = b""
        last = 0
        answered = False
        stage = 0
        pasted = 0
        try:
            while time.monotonic() - start < 30:
                if select.select([master], [], [], .01)[0]:
                    chunk = os.read(master, 65536)
                    if not chunk:
                        break
                    output += chunk
                    if b"\x1b[6n" in chunk:
                        os.write(master, b"\x1b[1;1R")
                if background and not answered and (not edit or stage >= 2 and time.monotonic() - pasted > .55) and b"\x1b]11;?" in output:
                    os.write(master, b"\x1b]11;rgb:" + b"/".join([background] * 3) + b"\x1b\\")
                    answered = True
                # Pi redraws the line using trailing spaces; Kilo resets SGR after the typed span.
                if edit and stage == 0 and b"\x1b[?25h\x1b[?2026l" in output:
                    os.write(master, b"\x1b[200~startup-proe\x1b[201~")
                    pasted = time.monotonic()
                    stage = 1
                if edit and stage == 1 and b"startup-proe" in output:
                    if b"\x1b[39m\x1b[49mstartup-proe" not in output:
                        raise RuntimeError("First edited text did not use terminal-native colors")
                    os.write(master, b"\x1b[Db")  # insert the missing letter before the final e
                    stage = 2
                if edit and stage == 2 and time.monotonic() - pasted > .07:
                    os.write(master, b"\r")
                    stage = 3
                if edit and stage == 3 and time.monotonic() - pasted > 2:
                    if not (b"Finishing startup" in output or b"Loading plugins" in output):
                        raise RuntimeError("No feedback for early Enter")
                    if b"FixtureReplyOK" in output:
                        raise RuntimeError("Submitted early")
                    os.write(master, b"\r")
                    stage = 4
                if model and b"FixtureReplyOK" in output:
                    if edit and stage != 4:
                        raise RuntimeError("Unexpected submission")
                    return elapsed()
                if last and (b"qz" in output if pi else re.search(rb"qz(?:qz)*\x1b\[0m", output)):
                    if background and not answered:
                        raise RuntimeError("Expected a terminal background query")
                    return elapsed()
                # Pi draws inline. In either renderer, wait for tty setup before injecting input.
                if not model and (bool(output) if pi else b"\x1b[?1049h" in output) and time.monotonic() - last >= .025:
                    os.write(master, b"qz")
                    last = time.monotonic()
            raise RuntimeError("No rendered prompt input within 30 seconds")
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
            os.close(master)
            if not pi and service != "private":
                # Only stop the benchmark's own registered child. `service stop` also manages OS login units.
                for file in (root / "profile/state/kilo2").glob("service*.json"):
                    registration = json.loads(file.read_text())
                    if registration.get("url") == f"http://127.0.0.1:{port}" and registration.get("pid", 0) > 1:
                        os.kill(registration["pid"], signal.SIGTERM)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--compare-pi", type=Path, help="Also measure the installed Pi CLI, alternating launch order")
    parser.add_argument("--submission", action="store_true", help="Also time launch through the first local model reply")
    parser.add_argument("--verify-draft", action="store_true", help="Verify paste, cursor edit, early Enter and late light theme")
    parser.add_argument("--service", choices=["private", "stopped", "running"], default="private")
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    cases = ["light", "dark", "silent"]
    apps = [("kilo", binary)]
    if args.compare_pi:
        apps.append(("pi", args.compare_pi.resolve(strict=True)))
    samples = {(name, case): [] for name, _ in apps for case in cases}
    wrapped = {key: [] for key in samples}
    for i in range(args.runs):
        for case in cases[i % 3:] + cases[:i % 3]:
            for name, path in (apps if i % 2 else reversed(apps)):
                samples[name, case].append(trial(path, {"light": b"ffff", "dark": b"0000", "silent": None}[case], name == "pi", service=args.service, timing=wrapped[name, case]))
    for (name, case), times in samples.items():
        print(f"{name} {case}: exec median {statistics.median(times)} ms; including harness {statistics.median(wrapped[name,case])} ms; samples {times}")
    if args.submission:
        with local_model() as url:
            times = [trial(binary, b"ffff", model=url, service=args.service) for _ in range(args.runs)]
            print(f"kilo first local reply: median {statistics.median(times)} ms; samples {times}")
    if args.verify_draft:
        with local_model() as url:
            trial(binary, b"ffff", model=url, service=args.service, edit=True)
            print("PASS: terminal-native initial prompt, edited paste retained, explicit Enter delivered fixture reply")
