# Kilo Headless & Embedding Capabilities

This document describes Kilo's capabilities for headless operation, machine-readable output, and embedding in other applications.

## Machine-Readable Output (`--format json`)

The `kilo run` command supports JSON output via the `--format` flag:

```bash
kilo run --format json "your prompt here"
```

When enabled, output is emitted as newline-delimited JSON events to stdout. Each event includes:

| Field | Description |
|-------|-------------|
| `type` | Event type (see below) |
| `timestamp` | Unix timestamp in milliseconds |
| `sessionID` | Session identifier |
| `...` | Event-specific payload |

### Event Types

| Type | Description |
|------|-------------|
| `tool_use` | Tool execution completed or errored |
| `text` | Assistant text response |
| `reasoning` | Model reasoning/thinking block |
| `step_start` | Processing step started |
| `step_finish` | Processing step completed |
| `error` | Session error occurred |

### Example Output

```json
{"type":"step_start","timestamp":1720000000000,"sessionID":"sess_abc123","part":{...}}
{"type":"tool_use","timestamp":1720000001000,"sessionID":"sess_abc123","part":{"tool":"Read","state":{"status":"completed"},...}}
{"type":"text","timestamp":1720000002000,"sessionID":"sess_abc123","part":{"type":"text","text":"Here is the result..."}}
```

## Local Server Mode (`kilo serve`)

Kilo exposes a headless HTTP server for programmatic access:

```bash
kilo serve [--port <port>] [--hostname <hostname>]
```

### Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | 4096 (or any free port) | Server port |
| `--hostname` | `0.0.0.0` | Bind address |

### Authentication

Set `KILO_SERVER_PASSWORD` to secure the server:

```bash
export KILO_SERVER_PASSWORD="your-secret"
kilo serve
```

Without this variable, the server runs unsecured (a warning is printed).

### API

The server exposes a REST API with WebSocket support for real-time events. The full OpenAPI specification is available at `packages/sdk/openapi.json`.

Key endpoints include:
- `POST /session` - Create a session
- `POST /session/{id}/prompt` - Send a prompt
- `POST /session/{id}/command` - Execute a slash command
- `GET /event/subscribe` - WebSocket event stream
- `GET /session/{id}` - Get session details
- `POST /permission/{id}/reply` - Reply to permission requests

## Non-Interactive / Headless Mode

By default, `kilo run` (without `--interactive`) operates in headless mode:

```bash
kilo run "your prompt here"
```

### Behavior

- Sends a single prompt and streams output
- Exits when the session becomes idle
- Automatically denies interactive elements:
  - User questions (`permission: question`)
  - Plan mode entry/exit
  - Interactive terminal requests

### Permission Handling

| Flag | Behavior |
|------|----------|
| (default) | Denies permission requests with a warning |
| `--dangerously-skip-permissions` | Auto-approves all permissions (use with caution) |
| `--auto` | Auto-approves permissions for autonomous/pipeline usage |

### Example: CI/CD Pipeline

```bash
kilo run --format json --auto "Run the test suite and report failures" 2>/dev/null | \
  jq -r 'select(.type == "text") | .part.text'
```

## Remote Attachment Mode

Connect to a running `kilo serve` instance:

```bash
kilo run --attach http://localhost:4096 \
  --password "$KILO_SERVER_PASSWORD" \
  --dir /path/to/project \
  "your prompt here"
```

This allows:
- Centralized server for multiple clients
- Cross-directory operations via `--dir`
- Session resumption with `--session` or `--continue`

## Programmatic SDK Usage

The TypeScript SDK (`@kilocode/sdk/v2`) provides typed access to all server functionality:

```typescript
import { createKiloClient } from "@kilocode/sdk/v2"

const client = createKiloClient({
  baseUrl: "http://localhost:4096",
  directory: "/path/to/project",
  headers: {
    Authorization: `Basic ${btoa(`kilo:${process.env.KILO_SERVER_PASSWORD}`)}`
  }
})

// Create a session
const session = await client.session.create({
  title: "Automated Task",
  permission: [
    { permission: "question", action: "deny", pattern: "*" }
  ]
})

// Subscribe to events
const events = await client.event.subscribe()

// Send a prompt
await client.session.prompt({
  sessionID: session.data.id,
  parts: [{ type: "text", text: "Your prompt here" }]
})

// Process events
for await (const event of events.stream) {
  if (event.type === "message.part.updated") {
    const part = event.properties.part
    if (part.type === "text" && part.time?.end) {
      console.log(part.text)
    }
  }
  
  if (event.type === "session.status" && 
      event.properties.status.type === "idle") {
    break
  }
}
```

## Summary

| Capability | Support | Method |
|------------|---------|--------|
| Machine-readable output | Yes | `--format json` |
| Local HTTP server | Yes | `kilo serve` |
| Headless/non-interactive | Yes | `kilo run` (default) |
| WebSocket events | Yes | `/event/subscribe` |
| TypeScript SDK | Yes | `@kilocode/sdk/v2` |
| Permission auto-approval | Yes | `--auto` or `--dangerously-skip-permissions` |
| Remote attachment | Yes | `--attach <url>` |

## Related Files

- CLI entry point: `packages/opencode/src/index.ts`
- Run command: `packages/opencode/src/cli/cmd/run.ts`
- Serve command: `packages/opencode/src/cli/cmd/serve.ts`
- Server implementation: `packages/opencode/src/server/server.ts`
- SDK client: `packages/sdk/js/src/v2/client.ts`
- OpenAPI spec: `packages/sdk/openapi.json`
