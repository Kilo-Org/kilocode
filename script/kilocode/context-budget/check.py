"""Measure the actual default CLI request. Run from the repository root."""

import hashlib
import json
import os
import signal
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from jinja2 import Environment
from tokenizers import Tokenizer


HERE = Path(__file__).resolve().parent
MODEL = "deepseek-flash"
REV = "08c8657f02291e11b6f6b63e0e16014f8e748518"


def artifact(name, digest):
    url = f"https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/resolve/{REV}/{name}"
    data = subprocess.check_output(["curl", "-fsSL", "--retry", "3", "--max-time", "60", url])
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Checksum mismatch: {name}")
    return data


def capture(root, tmp):
    requests = []

    class Provider(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if (self.path == "/v1/chat/completions" and body.get("model") == MODEL
                    and body.get("tools") and body["messages"][-1] == {"role": "user", "content": "Hi"}):
                requests.append(body)
            self.send_error(400, "Captured locally")

        def log_message(self, *_):
            pass

    home = tmp / "home"
    workspace = tmp / "empty"
    home.mkdir()
    workspace.mkdir()
    with HTTPServer(("127.0.0.1", 0), Provider) as server:
        url = f"http://127.0.0.1:{server.server_port}/v1"
        catalog = tmp / "models.json"
        catalog.write_text(json.dumps({"deepseek": {
            "id": "deepseek", "name": "DeepSeek", "env": ["DEEPSEEK_API_KEY"], "api": url,
            "npm": "@ai-sdk/openai-compatible", "models": {MODEL: {
                "id": MODEL, "name": "DeepSeek V4.1 Flash 1017", "family": MODEL,
                "reasoning": True, "tool_call": True, "attachment": True, "temperature": True,
                "release_date": "2026-10-17", "modalities": {"input": ["text", "image"], "output": ["text"]},
                "limit": {"context": 1048576, "output": 393216},
            }},
        }}))
        config = json.dumps({"providers": {"deepseek": {"settings": {"baseURL": url, "apiKey": "dummy"}}}})
        threading.Thread(target=server.serve_forever, daemon=True).start()
        env = {
            "PATH": os.environ["PATH"], "HOME": str(home), "SHELL": "/bin/bash", "TERM": "dumb",
            "INIT_CWD": str(workspace), "KILO_V2_PROFILE": str(tmp / "profile"), "KILO_CLIENT": "cli",
            "OPENCODE_CONFIG_CONTENT": config, "KILO_MODELS_PATH": str(catalog), "OPENCODE_MODELS_PATH": str(catalog),
            "KILO_DISABLE_MODELS_FETCH": "1", "OPENCODE_DISABLE_MODELS_FETCH": "1", "DEEPSEEK_API_KEY": "dummy",
        }
        process = subprocess.Popen(
            ["bun", str(root / "script/dev-isolated.ts"), "run", "--standalone", "-m", f"deepseek/{MODEL}", "Hi"],
            cwd=workspace, env=env, start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        try:
            output, _ = process.communicate(timeout=90)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            server.shutdown()
    if not requests:
        raise RuntimeError(f"No main coding request captured: {output.decode(errors='replace')[-2000:]}")
    return requests[0]


def main():
    with tempfile.TemporaryDirectory(prefix="kilo-budget-", dir="/tmp") as directory:
        request = capture(Path.cwd(), Path(directory))
    tokenizer = Tokenizer.from_buffer(artifact("tokenizer.json", "c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b"))
    env = Environment()
    env.filters["tojson"] = lambda value: json.dumps(value, ensure_ascii=False)
    template = env.from_string(artifact("chat_template.jinja", "95b7033a693b321ceaefb6f89ad07d1e0cf2b095305711f934a4ac649456739d").decode())
    prompt = template.render(**request, add_generation_prompt=True, bos_token="<｜begin▁of▁sentence｜>")
    tokens = len(tokenizer.encode(prompt, add_special_tokens=False).ids)
    budget = json.loads((HERE / "budget.json").read_text())
    names = {tool["function"]["name"] for tool in request["tools"]}
    allowed = set(budget["directTools"])
    delta = tokens - budget["maxInputTokens"]
    print(f"First request: {tokens} input tokens ({delta:+} vs ceiling), {len(names)} direct tools.")
    if names != allowed:
        print(f"Added: {sorted(names - allowed)}; removed: {sorted(allowed - names)}")
    if names != allowed or delta > 0:
        raise SystemExit(
            "Remove stale allowlist entries for tools that are no longer direct. For new actions, use on-demand "
            "discovery; move workflow guidance into a skill.\n"
            "Do NOT raise the token ceiling, allowlist a new direct tool, or weaken the check to make CI pass. "
            "If an exception is necessary, show the before/after counts and ask a human maintainer for explicit "
            "approval before editing the budget or check."
        )


if __name__ == "__main__":
    main()
