#!/bin/bash
set -e
API=https://storage.to/api
BIN=/workspace/722af77e-10d2-4d2c-a30a-d3e51cae1b82/sessions/agent_1e689b76-4077-4859-aa64-deb0db2c9270/packages/opencode/dist/@kilocode/cli-linux-x64/bin/kilo
WORK=$HOME/.local/kilo-upload
mkdir -p "$WORK"
VT=$(cat "$WORK/visitor-token" 2>/dev/null || (head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | tee "$WORK/visitor-token"))
SIZE=$(stat -c%s "$BIN")
NAME=kilo-btw-linux-x64

echo "size=$SIZE"
INIT=$(curl -s -X POST "$API/upload/init" -H "Content-Type: application/json" -H "X-Visitor-Token: $VT" \
  -d "{\"filename\":\"$NAME\",\"content_type\":\"application/octet-stream\",\"size\":$SIZE}")
echo "$INIT" | head -c 400; echo
echo "$INIT" > "$WORK/init.json"

UPLOAD_ID=$(echo "$INIT" | python3 -c "import json,sys; print(json.load(sys.stdin)['upload_id'])")
PART_SIZE=$(echo "$INIT" | python3 -c "import json,sys; print(json.load(sys.stdin)['part_size'])")
TOTAL=$(echo "$INIT" | python3 -c "import json,sys; print(json.load(sys.stdin)['total_parts'])")
OWNER=$(echo "$INIT" | python3 -c "import json,sys; print(json.load(sys.stdin)['owner_token'])")
echo "parts=$TOTAL part_size=$PART_SIZE"

python3 - "$INIT" "$BIN" "$PART_SIZE" "$TOTAL" "$WORK" <<'PY'
import json, sys, os
init, binpath, psize, total, work = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
data = json.loads(init)
urls = {int(k): v for k, v in data["initial_urls"].items()}
with open(binpath, "rb") as f:
    etags = {}
    for part in range(1, total + 1):
        chunk = f.read(psize)
        out = os.path.join(work, f"part{part}.json")
        if part in urls:
            url = urls[part]
        else:
            print(f"requesting url for part {part}", flush=True)
            import urllib.request
            req = urllib.request.Request(
                "https://storage.to/api/upload/parts",
                data=json.dumps({"upload_id": data["upload_id"], "part_numbers": [part]}).encode(),
                headers={"Content-Type": "application/json", "X-Visitor-Token": open(os.path.join(work, "visitor-token")).read().strip()},
            )
            resp = json.loads(urllib.request.urlopen(req).read())
            url = resp["part_urls"][0]["url"]
        print(f"uploading part {part}/{total} ({len(chunk)} bytes)", flush=True)
        req = urllib.request.Request(url, data=chunk, method="PUT")
        with urllib.request.urlopen(req) as r:
            etag = r.headers.get("ETag")
        etags[part] = etag
        with open(out, "w") as fh:
            json.dump(etag, fh)
    with open(os.path.join(work, "etags.json"), "w") as fh:
        json.dump([{"partNumber": p, "etag": e} for p, e in sorted(etags.items())], fh)
print("all parts uploaded", flush=True)
PY

python3 - "$UPLOAD_ID" "$OWNER" "$VT" "$WORK" <<'PY'
import json, sys, urllib.request
upload_id, owner, vt, work = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
etags = json.load(open(work + "/etags.json"))
req = urllib.request.Request(
    "https://storage.to/api/upload/complete-multipart",
    data=json.dumps({"upload_id": upload_id, "parts": etags}).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Owner {owner}", "X-Visitor-Token": vt},
)
print(urllib.request.urlopen(req).read().decode())
PY

curl -s -X POST "$API/upload/confirm" -H "Content-Type: application/json" -H "X-Visitor-Token: $VT" \
  -d "{\"filename\":\"$NAME\",\"size\":$SIZE,\"content_type\":\"application/octet-stream\",\"r2_key\":\"$(echo "$INIT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["r2_key"])')\"}"
echo
