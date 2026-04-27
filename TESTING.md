# TESTING.md

How to spin up the **local main-branch** Kilo backend and test it with `curl` / `fetch`. Aimed at a running Kilo CLI agent iterating on backend fixes without rebuilding the VS Code extension, TUI, or desktop app.

All examples use plain shell + `curl`. Writing TypeScript files is a last resort (see Section 8).

## TL;DR

```bash
# From repo root. Starts the LOCAL main-branch backend in the background.
PASS=$(openssl rand -hex 16)
KILO_SERVER_PASSWORD="$PASS" bun dev serve --port 0 >/tmp/kilo-serve.log 2>&1 &
echo $! >/tmp/kilo-serve.pid
while ! grep -q "kilo server listening" /tmp/kilo-serve.log 2>/dev/null; do sleep 0.1; done
PORT=$(grep -oE "listening on http://[^:]+:[0-9]+" /tmp/kilo-serve.log | grep -oE "[0-9]+$")
AUTH="Authorization: Basic $(printf 'kilo:%s' "$PASS" | base64 | tr -d '\n')"
BASE="http://127.0.0.1:$PORT"

# Call any endpoint
curl -sS -H "$AUTH" -H "x-kilo-directory: $PWD" "$BASE/global/health"

# Stop when done
kill "$(cat /tmp/kilo-serve.pid)" 2>/dev/null || true
rm -f /tmp/kilo-serve.pid /tmp/kilo-serve.log
```

## 1. What this doc is for

Testing local backend fixes against a real running server, talking to it over HTTP the same way the VS Code extension, TUI, and `kilo run --attach` do — but without any of those clients. Every request is a `curl` the agent can copy-paste.

For in-process tests (no socket, fastest loop) see `packages/opencode/test/kilocode/server/permission-allow-everything.test.ts` for the `Server.Default().app.request(...)` pattern. That's the right tool inside the `packages/opencode/` test suite; this doc is for out-of-process HTTP testing.

## 2. `kilo serve` vs `bun dev serve` — important

| Command | What it runs |
|---|---|
| `kilo serve` | The npm-installed production CLI on `$PATH`. **Not the code in this repo.** |
| `bun dev serve …` (repo root) | The local main-branch backend from this worktree. **This is what you want.** |
| `bun run --cwd packages/opencode --conditions=browser src/index.ts serve …` | Same as `bun dev serve`, fully expanded. |

Root `package.json` defines `"dev"` as the full `bun run --cwd packages/opencode --conditions=browser src/index.ts` invocation, so `bun dev <args>` forwards `<args>` to the local CLI entry point (`packages/opencode/src/index.ts`) without touching the installed binary.

`bun dev` imports the source directly — no rebuild is needed between code edits. Just kill the running server and relaunch.

Do **not** use `createKiloServer()` from `@kilocode/sdk/v2` to test local code: it spawns the PATH `kilo` binary (`packages/sdk/js/src/v2/server.ts:38-136`), which is the wrong tool here.

## 3. Starting the backend (background)

### Random port (recommended)

```bash
KILO_SERVER_PASSWORD=$(openssl rand -hex 16) \
  bun dev serve --port 0 >/tmp/kilo-serve.log 2>&1 &
echo $! >/tmp/kilo-serve.pid
while ! grep -q "kilo server listening" /tmp/kilo-serve.log; do sleep 0.1; done
PORT=$(grep -oE "listening on http://[^:]+:[0-9]+" /tmp/kilo-serve.log | grep -oE "[0-9]+$")
```

### Fixed port (if you need a stable URL)

```bash
KILO_SERVER_PASSWORD=secret \
  bun dev serve --port 4096 --hostname 127.0.0.1 \
  >/tmp/kilo-serve.log 2>&1 &
echo $! >/tmp/kilo-serve.pid
while ! grep -q "kilo server listening" /tmp/kilo-serve.log; do sleep 0.1; done
PORT=4096
```

### No-auth quickstart (fastest)

Omit `KILO_SERVER_PASSWORD` entirely. The server prints `Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.` and the auth middleware is bypassed — fine for throwaway local testing, never for anything else.

```bash
bun dev serve --port 0 >/tmp/kilo-serve.log 2>&1 &
echo $! >/tmp/kilo-serve.pid
while ! grep -q "kilo server listening" /tmp/kilo-serve.log; do sleep 0.1; done
PORT=$(grep -oE "listening on http://[^:]+:[0-9]+" /tmp/kilo-serve.log | grep -oE "[0-9]+$")
BASE="http://127.0.0.1:$PORT"
# no AUTH var needed
```

### Flags (`packages/opencode/src/cli/network.ts`)

| Flag | Default | Notes |
|---|---|---|
| `--port` | `0` (OS-assigned) | Must be passed literally when overriding `opencode.json`'s `server.port`. |
| `--hostname` | `127.0.0.1` | Becomes `0.0.0.0` when `--mdns` is set without an override. |
| `--mdns` | `false` | Publishes an mDNS SRV record. |
| `--mdns-domain` | `kilo.local` | |
| `--cors` | `[]` | Extra allowed origins. |

## 4. The two mandatory request knobs

### Auth header (only if `KILO_SERVER_PASSWORD` was set)

```bash
AUTH="Authorization: Basic $(printf 'kilo:%s' "$KILO_SERVER_PASSWORD" | base64 | tr -d '\n')"
```

The username is literally `kilo` (same as the VS Code extension). Skip this whole block if you launched without a password.

### Directory header on every call

```bash
DIR_HEADER="x-kilo-directory: $PWD"
```

`InstanceMiddleware` uses this to scope the request to a project. For `GET` / `HEAD`, pass `?directory=<urlencoded>` in the URL instead — that's what the SDK does internally.

## 5. Common `curl` recipes

All of the below assume `BASE`, `AUTH`, `DIR_HEADER` are set. Drop `-H "$AUTH"` if you're running without a password.

### Health check (no auth, no directory)

```bash
curl -sS "$BASE/global/health"
```

### Full endpoint list (OpenAPI spec)

```bash
curl -sS "$BASE/doc" | jq .
```

This is the source of truth — anything not in this doc is discoverable from `/doc` without reading source.

### Create a session

```bash
SID=$(curl -sS -X POST "$BASE/session" \
  -H "$AUTH" -H "$DIR_HEADER" -H "Content-Type: application/json" \
  -d '{}' | jq -r .id)
echo "$SID"
```

### List sessions (GET — directory goes in the query)

```bash
curl -sS -H "$AUTH" \
  "$BASE/session?directory=$(printf %s "$PWD" | jq -sRr @uri)"
```

### Send a message (fire-and-forget)

```bash
curl -sS -X POST "$BASE/session/$SID/prompt_async" \
  -H "$AUTH" -H "$DIR_HEADER" -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"hello"}]}'
```

### Read messages for a session

```bash
curl -sS -H "$AUTH" \
  "$BASE/session/$SID/message?directory=$(printf %s "$PWD" | jq -sRr @uri)"
```

### Abort an in-flight prompt

```bash
curl -sS -X POST -H "$AUTH" -H "$DIR_HEADER" "$BASE/session/$SID/abort"
```

### Get the resolved config (verify a config change took effect)

```bash
curl -sS -H "$AUTH" \
  "$BASE/config?directory=$(printf %s "$PWD" | jq -sRr @uri)"
```

### Stream global events (SSE)

```bash
curl -N -sS -H "$AUTH" \
  "$BASE/global/event?directory=$(printf %s "$PWD" | jq -sRr @uri)"
```

`-N` disables curl's output buffering so events appear live. Expect lines like `data: {"directory":"…","payload":{"type":"…",…}}`.

## 6. Stopping the backend

```bash
kill "$(cat /tmp/kilo-serve.pid)" 2>/dev/null || true
rm -f /tmp/kilo-serve.pid /tmp/kilo-serve.log
```

`ServeCommand` handles `SIGTERM` / `SIGINT` / `SIGHUP` and runs `Instance.disposeAll()` + `server.stop(true)` before exiting (`packages/opencode/src/cli/cmd/serve.ts:29-31`). `-9` is only needed if the process hangs past ~5 s.

## 7. Useful environment variables

| Var | Why you'd set it |
|---|---|
| `KILO_SERVER_PASSWORD` | Enable Basic auth. Omit for auth-bypassed local testing. |
| `KILO_DB=":memory:"` | Skip on-disk SQLite — hermetic runs. |
| `KILO_DISABLE_DEFAULT_PLUGINS=true` | Don't auto-load bundled plugins. |
| `KILO_WORKSPACE_ID=<id>` | Single-workspace mode; disables control-plane routes. |
| `KILO_TELEMETRY_LEVEL=off` | Disable PostHog during tests. |
| `KILO_CONFIG_CONTENT='{…}'` | Inline JSON config without writing a file. |

## 8. Last resort: typed SDK via a throwaway script

Use this only when `curl` can't express what you need — typed request/response shapes, complex multi-turn orchestration, SSE consumers that need to coalesce events. Keep the file short and delete it after.

```ts
// /tmp/probe.ts — delete after use. Talks to an already-running backend.
import { createKiloClient } from "@kilocode/sdk/v2"

const port = process.env.PORT!
const pass = process.env.KILO_SERVER_PASSWORD
const headers = pass
  ? { Authorization: "Basic " + Buffer.from("kilo:" + pass).toString("base64") }
  : undefined

const client = createKiloClient({
  baseUrl: `http://127.0.0.1:${port}`,
  headers,
  directory: process.cwd(),
})

const { data: session } = await client.session.create({}, { throwOnError: true })
await client.session.promptAsync({
  sessionID: session.id,
  parts: [{ type: "text", text: "hello" }],
})

const events = await client.global.event({})
for await (const ev of events.stream) {
  const e = ev as { payload: { type: string } }
  console.log(e.payload.type)
  if (e.payload.type === "session.idle") break
}
```

```bash
PORT="$PORT" KILO_SERVER_PASSWORD="$KILO_SERVER_PASSWORD" bun /tmp/probe.ts
rm /tmp/probe.ts
```

Reminder: this script **connects to** the server you launched in Section 3 — it does not start one. `createKiloServer()` from the SDK would spawn the PATH `kilo` binary (production CLI), which defeats the point of testing local code.

## 9. Pitfalls

- Running `kilo serve` instead of `bun dev serve` runs the installed prod binary, not your edits.
- Missing `x-kilo-directory` (or `?directory=`) returns `400` from `InstanceMiddleware`.
- `curl` without `-N` buffers SSE output — you won't see events until the connection closes.
- Hardcoding port `4096` breaks when a previous run didn't exit cleanly. Parse the log instead.
- `--port` must appear literally in `argv` to override `opencode.json`'s `server.port` (`packages/opencode/src/cli/network.ts:45`).
- `KILO_SERVER_PASSWORD` must be set **before** launch — changing it after doesn't rotate credentials.
- When sharing `/tmp/kilo-serve.log` / `.pid` across terminals, unique-suffix the paths to avoid clobbering parallel runs.

## 10. After changing server routes

Regenerate the SDK and OpenAPI spec so `/doc` and typed clients stay in sync:

```bash
./script/generate.ts    # from repo root
```

See `AGENTS.md` for the full rationale.
