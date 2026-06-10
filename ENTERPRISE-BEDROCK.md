# Enterprise Bedrock-Only Mode (EU West 1)

This fork of Kilo Code is configured to run **exclusively** with AWS Bedrock in the **eu-west-1** region as the LLM provider. All connections to Kilo Gateway, external telemetry, session sharing, and cloud services are disabled. No other AWS region is allowed.

## Quick Start

1. Set the environment variable `BEDROCK_ONLY=true`
2. Set `AWS_REGION=eu-west-1` (mandatory — no other region is accepted)
3. Configure AWS credentials (one of):
   - `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
   - `AWS_PROFILE`
   - Standard AWS credential chain (instance profile, ECS task role, etc.)
4. Run `kilo run` or `kilo serve`

```bash
export BEDROCK_ONLY=true
export AWS_REGION=eu-west-1
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

kilo run
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `BEDROCK_ONLY` | **Yes** | Set to `true` or `1` to enable Bedrock-only mode |
| `AWS_REGION` | **Yes** | Must be `eu-west-1`. Any other value causes a startup error |
| `AWS_ACCESS_KEY_ID` | Conditional | AWS access key (required if not using profile) |
| `AWS_SECRET_ACCESS_KEY` | Conditional | AWS secret key (required if not using profile) |
| `AWS_PROFILE` | Conditional | AWS profile name (alternative to access key) |
| `AWS_SESSION_TOKEN` | Optional | Temporary session token for STS credentials |

If `BEDROCK_ONLY=true` is set without proper AWS configuration, the application will fail with a clear error:

```
Enterprise Bedrock-only mode is enabled. AWS Bedrock must be configured.
No fallback provider is allowed. Set AWS_REGION and one of
(AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY, AWS_PROFILE, or standard AWS credential chain).
```

## Security Guarantees

### What is disabled

1. **Kilo Gateway** — All communication with `api.kilo.ai`, `chat.kiloapps.io`, `events.kiloapps.io`, and `ingest.kilosessions.ai` is blocked at the network level
2. **Telemetry** — PostHog analytics (`us.i.posthog.com`) is completely disabled. No events are sent
3. **Session export** — Session data is never uploaded to any external service
4. **Remote sessions** — WebSocket connections to `ingest.kilosessions.ai` are blocked
5. **Session sharing** — Session sharing functionality is disabled
6. **Remote config** — No `.well-known/opencode` or remote configuration is fetched
7. **Auto-update** — No npm registry checks are performed
8. **Model catalog** — No external model catalog is fetched from `models.dev`
9. **Network guard** — A centralized fetch/WebSocket guard blocks all non-Bedrock HTTP requests
10. **Provider restriction** — Only `@ai-sdk/amazon-bedrock` is available as a bundled provider

### What is blocked at the network level

The network guard blocks connections to these domains:

- `kilo.ai` / `api.kilo.ai` / `app.kilo.ai`
- `kiloapps.io` / `chat.kiloapps.io` / `events.kiloapps.io`
- `kilosessions.ai` / `ingest.kilosessions.ai`
- `kilocode.ai`
- `us.i.posthog.com` / `posthog.com`
- `models.dev`
- Any other non-Bedrock endpoint

### What is allowed

Only AWS Bedrock endpoints are allowed:

- `bedrock-runtime.<region>.amazonaws.com`
- `bedrock.<region>.amazonaws.com`

### Environment variable protection

Setting `BEDROCK_ONLY=true` also sets:

- `KILO_TELEMETRY_LEVEL=off`
- `POSTHOG_DISABLED=1`
- `DO_NOT_TRACK=1`

## Allowed AWS Bedrock Endpoints

Only endpoints in the **eu-west-1** region are permitted:

| Endpoint | Purpose |
|---|---|
| `bedrock-runtime.eu-west-1.amazonaws.com` | Bedrock Runtime API (invoke model) |
| `bedrock.eu-west-1.amazonaws.com` | Bedrock Control Plane API |

Any request to a different region (e.g., `us-east-1`, `eu-central-1`) is blocked.

## Static Audit

Run the network audit script to verify no forbidden endpoints remain in the source:

```bash
npm run audit:network
# or
bun run audit:network
```

This script scans the source code for references to Kilo Gateway endpoints, telemetry services, and other forbidden patterns. It exits with code 1 if any are found.

## Running Tests

```bash
cd packages/opencode
bun test test/kilocode/enterprise/
```

## Known Limitations

1. **Plugin-based providers** — Third-party plugins loaded at runtime could theoretically add non-Bedrock providers. The network guard will block their outbound requests, but the plugin itself will still be loaded
2. **MCP servers** — MCP (Model Context Protocol) servers configured in `kilo.json` may make their own network requests. These are not intercepted by the Bedrock-only guard
3. **LSP servers** — Language servers may have their own network activity
4. **Build-time dependencies** — `package.json` still lists all provider SDKs as dependencies. Only the runtime provider map is restricted
5. **Source code references** — The source code still contains references to Kilo Gateway in comments, type definitions, and test fixtures. These are not active code paths but are flagged by the audit script

## Files Modified

| File | Change |
|---|---|
| `packages/opencode/src/kilocode/enterprise/bedrock-only.ts` | New: Central Bedrock-only configuration |
| `packages/opencode/src/kilocode/enterprise/network-guard.ts` | New: Network guardrail implementation |
| `packages/opencode/src/kilocode/enterprise/index.ts` | New: Enterprise module exports |
| `packages/opencode/src/index.ts` | Added: Network guard installation, telemetry disable, auth migration skip |
| `packages/opencode/src/provider/provider.ts` | Modified: Bedrock-only provider map |
| `packages/opencode/src/provider/models.ts` | Modified: Skip Kilo Gateway model fetch |
| `packages/opencode/src/session/network.ts` | Modified: Remove kilo.ai from probe URLs |
| `packages/opencode/src/config/config.ts` | Modified: Skip remote config fetch |
| `packages/opencode/src/cli/upgrade.ts` | Modified: Disable auto-update |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts` | Modified: Skip Kilo default model |
| `packages/opencode/src/kilocode/session-export/eligibility.ts` | Modified: Disable session export |
| `packages/opencode/src/kilo-sessions/kilo-sessions.ts` | Modified: Disable remote sessions |
| `packages/opencode/src/share/share-next.ts` | Modified: Disable session sharing |
| `packages/kilo-telemetry/src/client.ts` | Modified: PostHog disabled in Bedrock-only |
| `packages/kilo-telemetry/src/identity.ts` | Modified: Skip fetchProfile in Bedrock-only |
| `packages/opencode/test/kilocode/enterprise/bedrock-only.test.ts` | New: Bedrock-only tests |
| `packages/opencode/test/kilocode/enterprise/network-guard.test.ts` | New: Network guard tests |
| `script/audit-network.js` | New: Static network audit script |
| `package.json` | Added: `audit:network` script |
