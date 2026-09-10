# Telemetry and Observability: v1 Audit and v2 Overlap Analysis

## 1. Executive Summary

This document audits the telemetry and OpenTelemetry implementations across Kilo v1 (`origin/main`) and the v2 fork (`HEAD 59b29de409`).

In v1, Kilo implemented a proprietary PostHog-based telemetry pipeline (`@kilocode/kilo-telemetry`) that was **enabled by default**, sent events to `us.i.posthog.com` with a hardcoded API key, and exposed `/telemetry/capture` and `/telemetry/setEnabled` HTTP endpoints on the server.

In v2, upstream OpenCode discarded PostHog entirely, removed `experimental.openTelemetry` from user configuration (marking it `unsupportedExperimental`), and moved to standard process-level OpenTelemetry (OTLP HTTP) traces and logs via `@opencode-ai/util/observability` and `@effect/opentelemetry`.

A privacy review found that attaching the process-level `Observability.layer` would expand export to ambient logs and span attributes, without establishing a transcript/secret-free contract for those producers. The Kilo preview instead uses a bounded activity exporter in `packages/kilo-cli/src/telemetry.ts`. It consumes the public client `event.subscribe` stream, filters an allowlist of safe event names (four registry-update names plus name-only host/session/execution lifecycle names), ignores raw `event.data`, and emits standard OTLP JSON logs to a user-specified collector. Resource fields use fixed defaults, explicitly configurable client/version/channel labels, and a random per-run identifier; they are not derived from sessions. It is **OFF by default** and requires explicit opt-in, now backed by a persistent isolated consent file adapter (`packages/kilo-cli/src/telemetry-settings.ts`). This audit does not claim every upstream log or trace contains sensitive data.

**Parity statement:** the v2 exporter is not v1 parity. v1 emitted 27 named event types with rich properties; v2 exports a small allowlist of event *names only*, with no payloads, no identity, and no usage metrics. Section 6 enumerates every omission with evidence.

## 2. Audit of v1 Source (`origin/main`)

### 2.1 Architecture and Transport
In `origin/main`, telemetry was implemented in `packages/kilo-telemetry/`:
- **Client**: `packages/kilo-telemetry/src/client.ts` used `posthog-node` (v4.4.1), sending data directly to `https://us.i.posthog.com` using a hardcoded project token.
- **Identity**: `packages/kilo-telemetry/src/identity.ts` generated and persisted an anonymous machine ID to `<data path>/telemetry-id`, and cached the authenticated email in `telemetry-profile.json` (keyed by token hash, 7-day TTL). When authenticated, it identified the user by email and aliased the machine ID to it, attaching the organization ID.
- **Events**: `packages/kilo-telemetry/src/events.ts` defined a `TelemetryEvent` enum covering CLI lifecycle, sessions, LLM completions, feature usage (commands, tools, agents), indexing metrics, share actions, MCP connections, and error events.
- **Lifecycle**: `packages/opencode/src/kilocode/cli/setup.ts` initialized telemetry during `KiloCli.bootstrap()`, fired `CLI_START`, scheduled background flushes, and called `Telemetry.shutdown(2000)` on process exit.

### 2.2 Configuration and Defaults
- In v1, telemetry was **enabled by default**.
- `packages/core/src/v1/config/config.ts` defined `experimental.openTelemetry` defaulting to `true` (`Schema.withDecodingDefault(Effect.succeed(true))`).
- `packages/opencode/src/kilocode/cli/setup.ts` resolved consent as `cfg.experimental?.openTelemetry !== false` — an opt-OUT switch.
- `packages/kilo-telemetry/src/telemetry.ts` then applied `KILO_TELEMETRY_LEVEL`: when set, `level === "all"` forced telemetry **on regardless of the persisted opt-out**; any other value disabled it. This is a consent weakness of v1 worth recording.
- Consent could also be flipped at runtime through the `/telemetry/setEnabled` server route.

### 2.3 Server API Endpoints
- `packages/opencode/src/kilocode/server/httpapi/groups/telemetry.ts` registered `/telemetry/capture` and `/telemetry/setEnabled` routes under `InstanceHttpApi`.
- `packages/opencode/src/kilocode/server/httpapi/handlers/telemetry.ts` bridged these routes to `Telemetry.track()` and `Telemetry.setEnabled()`.

### 2.4 v1 Event Enum Inventory

The full `TelemetryEvent` enum (27 values, human-readable names) with data carried per event:

| Group | Events | Payload data |
|---|---|---|
| CLI lifecycle | `CLI Start`, `CLI Exit` | duration, exit code |
| Session | `Session Start`, `Session End`, `Session Message` | sessionId, model, provider, message counts, token counts, duration, user/assistant source |
| Model usage | `LLM Completion` | apiProvider, modelId, input/output/cache tokens, cost, duration |
| Feature usage | `Command Used`, `Tool Used`, `Agent Used`, `Plan Followup`, `Suggestion Shown`, `Suggestion Accepted` | command/tool/agent names, sessionIds, request ids, choice enums |
| Code indexing | `Indexing Started`, `Indexing Completed`, `Indexing File Count`, `Indexing Batch Retry`, `Indexing Error` | provider, vector store, modelId, file counts, batch errors, error strings |
| Share | `Share Created`, `Share Deleted` | sessionId |
| MCP | `MCP Server Connected`, `MCP Server Error` | server name, error strings |
| Remote | `Remote Connection Opened` | none |
| Auth | `Auth Success`, `Auth Logout` | provider |
| Config | `Telemetry Disabled` | none |
| Feedback | `Feedback Submitted` | provider/model, rating, message ids |
| Errors | `Error` | error string, context |

Session IDs, provider/model identifiers, error strings, and (via identity) the user email were all transmitted. This is data-bearing telemetry; the v2 safe event contract deliberately does not reproduce it.

## 3. Audit of v2 Upstream Observability (`HEAD 59b29de`)

### 3.1 Migration to OTLP HTTP
Upstream v2 replaced custom SaaS telemetry with standard OpenTelemetry (OTLP HTTP):
- `packages/util/src/observability.ts`: Exports `Observability.layer` and `Observability.node`.
- `packages/util/src/observability/otlp.ts`: Configures `OtlpLogger` (from `effect/unstable/observability` targeting `${endpoint}/v1/logs`) and `tracingLayer` (using `@effect/opentelemetry/NodeSdk`, `@opentelemetry/exporter-trace-otlp-http` targeting `${endpoint}/v1/traces`, and `BatchSpanProcessor`).
- Resource metadata is built by `resource(app)`, generating attributes for `opencode.client`, `opencode.run`, `service.instance.id`, and `deployment.environment.name`.

### 3.2 Removal of `openTelemetry` from Configuration
Upstream explicitly eliminated `experimental.openTelemetry` from the v2 configuration schema:
- `specs/v2/config.md`: line 380 records:
  `| experimental.openTelemetry | Enable AI SDK telemetry spans | remove | Do not port; observability is process-level and should use standard OpenTelemetry environment or declarative configuration. |`
- `packages/core/src/config/normalize.ts`: line 50 places `"openTelemetry"` into `unsupportedExperimental`. Supplying `experimental: { openTelemetry: ... }` produces an `unsupported` diagnostic.

### 3.3 Privacy Analysis of Process-Level Layer
- Attaching upstream's `Observability.layer` expands capture to logs and spans in its runtime scope, subject to the configured filters and sampling.
- The adapter has not established that every ambient producer is safe for product telemetry. Exporting those payloads would therefore exceed its allowlisted, content-free contract.
- Kilo v2 avoids global log/span capture, implementing an isolated activity subscriber instead.

## 4. Reuse vs. Delta Matrix

| Dimension | Kilo v1 (`origin/main`) | Upstream v2 (`HEAD 59b29de`) | Kilo v2 Safe Activity Exporter (`telemetry.ts`) |
|---|---|---|---|
| Protocol / Backend | PostHog HTTP API (`us.i.posthog.com`) | OpenTelemetry OTLP HTTP (`/v1/logs`, `/v1/traces`) | Standard OTLP JSON logs (`/v1/logs`) |
| Third-party SaaS | Hardcoded PostHog API key | None | None (local or user-specified collector only) |
| Default State | ON by default | OFF unless `OTEL_EXPORTER_OTLP_ENDPOINT` set | OFF by default; requires explicit opt-in |
| Endpoint Source | Fixed remote SaaS | Environment variables | Explicit option, persisted consent file, or `KILO_TELEMETRY_ENDPOINT` |
| Config Schema | `experimental.openTelemetry` (default true) | Rejected as `unsupportedExperimental` | Isolated consent file; no upstream schema edits |
| Consent Persistence | Opt-out config key + runtime route | None | Versioned consent file adapter (`telemetry-settings.ts`), atomic 0600 writes, fail-closed reads |
| Server Routes | `/telemetry/capture`, `/telemetry/setEnabled` | None | None (consumes public client `event.subscribe`) |
| Dependencies | `posthog-node` | `@effect/opentelemetry`, `@opentelemetry/*` | Zero new dependencies |
| Identity | Machine ID, email identify/alias, org ID | None | None (random per-run ID only) |
| Data Collected | 27 event types with rich properties | Traces, spans, structured log records | Allowlisted event names only; no raw payload fields |
| Sensitive Content | Sanitized client-side, but custom payloads | Global host logs (can capture prompts/errors) | Zero raw event data; `event.data` completely omitted |

## 5. v2 Safe Event Contract and Lifecycle Coverage

### 5.1 Contract
The exporter exports **event names only**. For every public server event, `event.data` is never read, so name-only export is payload-safe by construction. Safety therefore reduces to *which names* are exported, governed by two frozen allowlists:

- `SAFE_EVENT_TYPES` — registry-update notifications, empty payload schemas upstream: `agent.updated`, `catalog.updated`, `command.updated`, `config.updated`. Emitters: `packages/core/src/agent.ts:90`, `packages/core/src/catalog.ts:139`, `packages/core/src/command.ts:63`, `packages/core/src/config.ts:267`.
- `LIFECYCLE_EVENT_TYPES` — name-only host/session/execution lifecycle signals, each with a verified emitter on the actual public server stream:
  - `server.connected` — emitted per event-stream subscription, `packages/server/src/handlers/event.ts:16`.
  - `session.created` — `packages/core/src/session.ts:262`.
  - `session.deleted` — `packages/core/src/session.ts:362`.
  - `session.execution.started` / `session.execution.succeeded` / `session.execution.failed` / `session.execution.interrupted` — `packages/core/src/session/execution.ts:109-134`.

`EXPORTABLE_EVENT_TYPES` is the union and the only filter the exporter applies. A test asserts every name is an actual public server event type (`EventManifest.isServer`, plus the handler-emitted `server.connected`) and that content-bearing names (`session.text.delta`, `session.tool.called`, `permission.asked`, `tui.prompt.append`, …) stay outside.

### 5.2 Seams Assessment

Available seams:
1. **Public client `event.subscribe`**: exposed on `@opencode-ai/client`, providing an `AsyncIterable<{ id, created, type, data }>` stream of server domain events (`isOpenCodeEvent` in `packages/protocol/src/groups/event.ts:67`).
2. **Standard OTLP JSON logs format**: supported by OpenTelemetry collectors at `${endpoint}/v1/logs`.
3. **Effect scope lifecycle**: when run with `exportActivity`, an Effect finalizer aborts the subscription and cleanly shuts down background fibers without hanging.
4. **Isolated consent file**: `telemetry-settings.ts` persists opt-in consent outside the upstream config schema (which rejects telemetry keys), so no shared-file hook is needed.

Missing seams and product gaps:
1. **No product consent command yet**: the consent adapter exists, but the CLI command surface (enable/disable with confirmation) is parent-owned wiring and not implemented in this slice.
2. **No shared server route**: upstream has no telemetry HTTP route. Adding one would require modifying shared server route tables; deliberately not done.
3. **No safe global log filter**: upstream `Observability.layer` lacks attribute/field redaction filters for arbitrary logs and spans. Global log/span capture must not be used for telemetry.
4. **No session-turn idle event on the wire**: `session.idle` and `session.status` are defined in `packages/schema/src/session-status-event.ts` but have no publisher in `packages/core` today (grep over `packages/core/src` finds consumers only, e.g. `packages/kilo-cli/src/run.ts:151` waiting on `session.idle`). Until upstream emits them, no session-turn end signal can be exported.

## 6. v1 → v2 Coverage Overlap and Omissions

The four registry-update names do **not** mean v1 parity, and the lifecycle names do not either. Mapping every v1 event:

| v1 event | v2 exportable analog | Status |
|---|---|---|
| `CLI Start` | `server.connected` | Partial, name-only. `server.connected` fires per subscription, not per CLI process start. |
| `CLI Exit` | none | Omitted. No public shutdown event: `global.disposed` (`packages/schema/src/server-event.ts:6`) is outside `EventManifest.ServerDefinitions`, so subscribers never receive it. |
| `Session Start` | `session.created` | Name-only; no title/directory/sessionID. |
| `Session End` | none | Omitted. `session.idle`/`session.status` have no core publisher (§5.2); `session.deleted` covers removal only. |
| `Session Message` | `session.execution.started` | Coarse name-only run-start signal; no user/assistant source, no counts. |
| `LLM Completion` | `session.execution.succeeded` / `failed` / `interrupted` | Outcome names only. Tokens, cost, model, duration are payload data and are forbidden by the no-event-data contract. |
| `Command Used`, `Tool Used`, `Agent Used` | none | Omitted. v2's `command.updated`/`agent.updated` are registry-change notifications, not usage events; usage requires payload. |
| `Plan Followup` | none | Omitted. Choice data would require payload. |
| `Suggestion Shown`, `Suggestion Accepted` | none | Omitted. v2 has no public suggestion events. |
| Indexing events (5) | none | Omitted. No public indexing lifecycle on the v2 server stream. |
| `Share Created`, `Share Deleted` | none | Omitted. No public share events in `EventManifest.ServerDefinitions`. |
| `MCP Server Connected`, `MCP Server Error` | none | Omitted from the exportable set. `mcp.status.changed` exists and is public, but its name-only signal duplicates connect state without the connected/errored distinction the v1 events carried; not required for the core host/session/execution lifecycle scope. |
| `Remote Connection Opened` | none | Omitted. No public analog. |
| `Auth Success`, `Auth Logout` | none | Omitted. Auth identity must not touch telemetry in v2. |
| `Telemetry Disabled` | none | Omitted. Exporting that the user disabled telemetry is itself unwanted signal; disabled means zero emissions. |
| `Feedback Submitted` | none | Omitted. No public feedback events; rating data would require payload. |
| `Error` | `session.execution.failed` | Coarse name-only. Error strings are payload and never exported. |

Summary of deliberate omissions, each grounded above: all payload-bearing properties (session IDs, tokens, cost, model/provider identifiers, tool/command/agent names, error strings, emails); CLI process start/exit; session-turn end (blocked by the missing idle publisher); usage-per-invocation semantics; indexing, share, MCP, remote, auth, feedback, and suggestion events.

## 7. Consent Controls: v1 vs v2

| Control | v1 (`origin/main`) | v2 (`packages/kilo-cli`) |
|---|---|---|
| Default | ON (`experimental.openTelemetry` defaults true) | OFF; nothing emits without explicit opt-in |
| Opt-out | Set `experimental.openTelemetry: false` | N/A (no persistent ON state to opt out of) |
| Opt-in | `KILO_TELEMETRY_LEVEL=all` (forces on even over persisted opt-out) | `enabled: true` in the isolated consent file, or `KILO_TELEMETRY_ENABLED=1`, plus a valid collector endpoint |
| Persistence | User config file, mutable via server route | `telemetry-settings.ts`: versioned JSON file, atomic write (tmp + rename), file mode 0600, directory 0700 |
| Failure behavior | Level env overrides persisted decline | Fail-closed: absent, unreadable, symlinked, hardlinked, non-regular (FIFO), public-readable, oversized, corrupt, or schema-invalid consent files all read as disabled and never throw or hang; writes refuse to replace symlinked, shared, or non-regular existing files; an invalid endpoint disables; an explicit persisted `enabled: false` beats environment opt-in |
| File trust boundary | None recorded | Consent is adopted only from a regular, single-link, owner-private (no group/other bits) inode, verified again on the opened fd; bounded 64 KiB read so a planted file cannot hang or exhaust the host |
| Scope creep guard | Runtime `/telemetry/setEnabled` route | None; no route, no config schema edits, parent wires explicit CLI use only |

Consent resolution is presence-aware through `TelemetrySettings.resolve(file, env)` for host/CLI wiring: an absent consent file defers entirely to the environment (`resolveConfig(undefined, env)`), so an explicit pre-consent env opt-in keeps working, while any present file — enabled, declined, rejected, or corrupt — decides consent itself, and a declined/rejected/corrupt one forces OFF over the environment. The consent file schema is `{ version: 1, enabled, endpoint?, headers?, client?, channel? }`; unknown fields are dropped at the file boundary so junk in the file cannot flow into exporter configuration. `resolveConfig` remains the single owner of endpoint validation (HTTP/HTTPS only) and of the precedence rules; `telemetry-settings.input()` is a field-for-field bridge, not a second policy.

**CLI display constraint for parent wiring:** the consent file may carry credential-bearing headers and the resolved config carries them too, so the CLI surface must print only a status (enabled/disabled, target host decision), never the raw settings or resolved config.

**Judgment gate left to product/parent:** migrating the product default to ON (or re-introducing a v1-style opt-out) is a product decision, not implemented here. The adapter and exporter keep the OFF default regardless of that future decision.

## 8. Implementation Invariants & Verification

The safe activity exporter in `packages/kilo-cli/src/telemetry.ts` enforces the following invariants:
1. **Strict Opt-In**: Telemetry is disabled by default. It activates only when `enabled: true` is passed (directly or via the persisted consent file) or `KILO_TELEMETRY_ENABLED="1"` is set in the environment. Setting `OTEL_EXPORTER_OTLP_ENDPOINT` alone does not enable telemetry.
2. **Endpoint Validation**: Endpoints must be valid HTTP or HTTPS URLs. Invalid URLs, non-HTTP schemes (`file:`, `ftp:`), or empty strings disable telemetry.
3. **Strict Name Filtering**: Only the names in `EXPORTABLE_EVENT_TYPES` (`SAFE_EVENT_TYPES` ∪ `LIFECYCLE_EVENT_TYPES`, §5.1) are processed; every other public event is discarded.
4. **No Raw Event Payloads**: `event.data` is never inspected, serialized, or transmitted. The outgoing OTLP record contains only the allowlisted `event.type`, timestamp/severity, and resource fields (`service.name`, `service.version`, `opencode.client`, `deployment.environment.name`, `service.instance.id`, `opencode.run`). Client/version/channel can be explicitly configured and are transmitted as supplied; callers must not put secrets in those labels.
5. **Clean Shutdown & Bounded Requests**: Both `startActivityExporter` (`stop()`) and `exportActivity` (delegating to `startActivityExporter` via `Effect.acquireRelease`) abort the client event stream cleanly without process hang. Every individual OTLP POST request uses a bounded 5-second timeout (`AbortSignal.timeout(5000)`) so an unresponsive collector cannot block the activity stream. External abort listeners are cleanly unhooked on stop.
6. **Verified with Local Fake Collector and Live Isolated Host**: `packages/kilo-cli/test/telemetry.test.ts` covers synthetic event streams and an actual isolated host (`interactive-fixture.ts` run under the bundled Bun 1.4 runtime). Confirmed that the real `OpenCode` promise client satisfies `EventSubscriberClient`, that only exportable names (including `server.connected`) are emitted, that lifecycle payloads and content-bearing events are dropped, and that simulated confidential strings in event payloads are strictly omitted from outgoing OTLP records.
7. **Verified Consent Persistence**: `packages/kilo-cli/test/telemetry-settings.test.ts` covers the adapter end to end: default-disabled reads, atomic 0600/0700 persistence, restart-safe consent across a fresh process, fail-closed corrupt/invalid files, symlink/hardlink/FIFO/public-readable/oversized rejection without hanging, write refusal on foreign inodes, unknown-field dropping with secret sentinels, presence-aware `resolve()` semantics (missing file honors environment opt-in; declined/corrupt/foreign files force OFF over it), and the full settings → `resolve` → exporter chain against a local collector (zero requests when disabled; exactly the two exportable names when enabled).
