"""Exercise native Cloud History RPCs and detached transcript import on an isolated Kilo server."""
import base64
import json
import os
import pathlib
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

here = pathlib.Path(__file__).resolve().parent
root = here.parents[3]
with tempfile.TemporaryDirectory(prefix="kilo-cloud-history-") as tmp:
    profile = pathlib.Path(tmp).resolve()
    directory = profile / "project"
    directory.mkdir()
    config = profile / "config/kilo2"
    config.mkdir(parents=True)
    (config / "kilo2.json").write_text('{"session_sync":false}')
    password = secrets.token_urlsafe(32)
    env = {"PATH": os.environ["PATH"], "HOME": str(profile / "home"), "KILO_V2_PROFILE": str(profile),
           "OPENCODE_PASSWORD": password, "KILO_DISABLE_MODELS_FETCH": "1", "KILO_API_KEY": "fixture-cloud-only",
           "INIT_CWD": str(directory), "BUN_OPTIONS": "--preload " + str(here / "cloud-fixture.mjs")}
    proc = subprocess.Popen(["bun", "dev", "serve", "--port", "0", "--stdio"], cwd=root, env=env,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        server = json.loads(proc.stdout.readline())["url"]
        assert urllib.parse.urlparse(server).hostname in ("127.0.0.1", "localhost")
        def call(path, data=None):
            req = urllib.request.Request(server + path, data=None if data is None else json.dumps(data).encode(),
                headers={"Authorization": "Basic " + base64.b64encode(("opencode:" + password).encode()).decode(), "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.load(response)
        def rpc(method, input):
            return call("/api/rpc/kilocode.cloud-history/" + method + "?" + urllib.parse.urlencode({"location[directory]": str(directory)}), {"input": input})["output"]
        until = time.monotonic() + 25
        while True:
            try:
                assert rpc("capabilities", {}) == {"repositoryFilter": False, "publicLinks": False}
                listing = rpc("list", {"limit": 1})
                break
            except urllib.error.HTTPError as e:
                reason = json.load(e)
                if time.monotonic() >= until or reason.get("type") not in ("rpc.unavailable", "failed"):
                    raise RuntimeError(reason.get("message")) from None
                time.sleep(0.2)
        source = listing["items"][0]["sessionID"]
        assert source == "ses_fixture_cloud"
        for _ in range(2):
            transcript = rpc("download", {"sessionID": source})
            imported = call("/api/experimental/session/import", {**transcript, "location": {"directory": str(directory)}})["data"]
            assert imported["id"] != source and imported["location"]["directory"] == str(directory)
            assert "permissions" not in imported and "parentID" not in imported
            exported = call("/api/experimental/session/" + imported["id"] + "/export")["data"]
            user, assistant = exported["messages"]
            assert user["text"] == "Private fixture prompt" and user["id"] != "msg_cloud_user"
            assert assistant["content"][0]["text"] == "Private fixture response"
        print("Private fixture: listed 1, imported twice with fresh IDs, confirmed 2 ordered messages per copy, public links disabled.")
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
