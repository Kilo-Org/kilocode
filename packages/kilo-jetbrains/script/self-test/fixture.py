"""The only model in the smoke project: a loopback OpenAI-compatible endpoint."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Requests include fixture chat content; record only the selected operations.

    def reply(self, content_type, body, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply("application/json", b'{"data":[]}')

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.reply("application/json", b'{}', 404)
            return
        if self.headers.get("Authorization") != "Bearer fixture-only":
            self.reply("application/json", b'{}', 401)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        messages = body["messages"]
        names = {tool["function"]["name"] for tool in body.get("tools", []) if "function" in tool}
        user = next((json.dumps(m["content"]) for m in reversed(messages) if m["role"] == "user"), "")
        finish = "stop"
        delta = {"role": "assistant", "content": "Kilo fixture history"}
        event = "title"
        if "Generate a commit message for the following changes:" in user and "fixture.txt" in user and "+before" in user:
            delta["content"] = "test: add staged fixture"
            event = "commit-message"
        elif names and "Explain the selected code from fixture.txt:2" in user and "fixture_selection_42" in json.dumps(messages):
            delta["content"] = "KILO_FIXTURE_EXPLAINED"
            event = "editor-selection"
        elif names and "Explain the following terminal command" in user and "fixture_terminal_42" in user:
            delta["content"] = "KILO_FIXTURE_TERMINAL_EXPLAINED"
            event = "terminal-selection"
        elif names and "Check fixture continuity" in user:
            restored = any(m["role"] == "assistant" and "KILO_FIXTURE_EDIT_FINISHED" in json.dumps(m.get("content")) for m in messages)
            delta["content"] = "KILO_FIXTURE_RECONNECTED" if restored else "KILO_FIXTURE_MISSING_HISTORY"
            event = "reconnected" if restored else "missing-history"
        elif names and "Update the smoke fixture" in user:
            if any(m["role"] == "tool" and m.get("tool_call_id") == "fixture_edit" for m in messages):
                delta["content"] = "KILO_FIXTURE_EDIT_FINISHED"
                event = "edit-complete"
            else:
                name = next((n for n in ("patch", "apply_patch", "edit") if n in names), None)
                if not name:
                    self.server.events.append("missing-edit-tool:" + ",".join(sorted(names)))
                    self.reply("application/json", b'{"error":{"message":"No supported edit tool"}}', 422)
                    return
                args = {"patchText": "*** Begin Patch\n*** Update File: fixture.txt\n@@\n-before\n+after\n*** End Patch"}
                if name == "edit":
                    args = {"path": "fixture.txt", "oldString": "before", "newString": "after"}
                delta = {"role": "assistant", "tool_calls": [{"id": "fixture_edit", "index": 0, "type": "function",
                         "function": {"name": name, "arguments": json.dumps(args)}}]}
                finish, event = "tool_calls", name
        self.server.events.append(event)
        common = {"id": "fixture", "model": body["model"], "created": 1}
        if not body.get("stream"):
            self.reply("application/json", json.dumps({**common, "object": "chat.completion", "choices": [
                {"index": 0, "message": delta, "finish_reason": finish}]}).encode())
            return
        def data(payload, reason):
            chunk = {**common, "object": "chat.completion.chunk", "choices": [
                {"index": 0, "delta": payload, "finish_reason": reason}]}
            return "data: " + json.dumps(chunk) + "\n\n"
        self.reply("text/event-stream", (data(delta, None) + data({}, finish) + "data: [DONE]\n\n").encode())


def start():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    server.events = []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:" + str(server.server_port)
    config = {"model": "fixture/smoke", "providers": {"fixture": {
        "package": "@opencode/ai/providers/openai-compatible", "name": "Smoke fixture",
        "settings": {"baseURL": base + "/v1", "apiKey": "fixture-only"},
        "models": {"smoke": {"name": "Smoke", "limit": {"context": 200000, "output": 4000}}},
    }}, "permissions": [{"action": "edit", "resource": "*", "effect": "ask"}]}
    return server, config, base
