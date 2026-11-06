# `@kilocode/kilo-e2e`

Private, non-shipping end-to-end contract package for Kilo IDE clients. It owns the IDE-neutral fixture descriptor, scenario manifest, provider/driver subprocess protocol, redacted evidence report, cleanup result, and the coordinator that runs them in order. It is not a product dependency and must not be imported by shipping packages.

IDE-specific UI drivers and the Cloud fixture provider live in their own consumers; this package only defines and validates the shared contract and lifecycle.

## Commands

```bash
# Package checks
bun run typecheck
bun test

# One command: fake fixture provider + fake IDE driver, schema-valid redacted evidence
bun run demo
bun run demo -- --all
bun run demo -- --scenario permission.continue --lane cloud

# Regenerate or verify the language-neutral JSON Schema documents
bun run schema:generate
bun run schema:check
```

`demo` prints a JSON summary with the evidence path for each cell. Evidence is written to
`<artifacts>/<runId>/evidence.json`.

## Layout

| Path | Purpose |
|---|---|
| `src/schema.ts` | Versioned zod contracts and JSON Schema generation. |
| `src/scenarios.ts` | Stable `session.open`, `prompt.stream`, `permission.continue` manifests for `lane=local|cloud`. |
| `src/coordinator.ts` | Validate -> provider prepare -> deterministic git fixture -> driver -> evidence validation -> cleanup. |
| `src/evidence.ts` | Evidence/driver validation, secret rejection, artifact path containment. |
| `src/env.ts` | Descriptor-to-CLI/IDE environment mapping and loopback origin checks. |
| `src/protocol.ts` | Atomic private JSON request/result file helpers. |
| `src/process.ts` | Subprocess invocation with timeout and cancellation. |
| `src/git.ts` | Deterministic git fixture. |
| `schema/*.v<version>.json` | Generated draft-2020-12 JSON Schema for non-TypeScript consumers. |
| `fixtures/` | Fake provider and driver processes used by the demo and tests. |

## Provider and driver protocol

Both subprocesses are invoked with exactly two argv flags, which contain file paths only:

```text
<command...> --request <request.json> --result <result.json>
```

The coordinator writes the request file and reads the result file. The subprocess writes the result file at the requested path. Credentials are never placed on the command line.

- Provider request (`provider-request.v<version>.json`) is a discriminated union on `operation`:
  - `prepare`: run/lane metadata, descriptor path, deterministic project directory, isolated XDG state dirs.
  - `cleanup`: run id, descriptor path, and whether the descriptor exists.
- The provider writes the private fixture descriptor (mode `0600`) to the requested descriptor path during `prepare`, then writes `provider-prepare-result.v<version>.json`.
- During `cleanup` the provider writes `cleanup-result.v<version>.json`. Cleanup runs after success, assertion failure, driver crash, timeout, cancellation, invalid evidence, and provider prepare failure. A failed cleanup fails the run.
- Driver request (`driver-request.v<version>.json`) contains the scenario manifest, descriptor path, deterministic project identity (`path`, `branch`, `commit`), run directory, and artifact directory. Credentials reach the driver only through its inherited environment.
- Driver result (`driver-result.v<version>.json`) contains provenance, capability flags, named assertions, last non-secret state, artifact paths, and the scenario outcome. A `passed` outcome must include a passing named assertion for every `expected.ui` and `expected.model` entry in the manifest and must not report any failed assertion; contradictory results are rejected.

Artifact paths in evidence are relative to the run directory and must stay inside it.

## Environment mapping

The coordinator derives the child environment from the fixture descriptor, stripping ambient `KILO_*`, `CLOUD_AGENT_*`, `EVENT_SERVICE_*`, and `XDG_*` variables first:

| Descriptor field | Environment |
|---|---|
| `origins.web` | `KILO_API_URL`, `KILO_WEB_APP_URL` |
| `origins.cloudAgent` | `CLOUD_AGENT_NEXT_BASE_URL` |
| `origins.sessionIngest` | `KILO_SESSION_INGEST_URL` (else `KILO_DISABLE_SESSION_INGEST=1`) |
| `origins.events` | `EVENT_SERVICE_URL` (else `KILO_DISABLE_PRESENCE=1`) |
| `origins.gateway` | `KILO_AI_GATEWAY_URL` |
| `credentials.apiKey` | `KILO_API_KEY` |
| `credentials.orgId` | `KILO_ORG_ID` |
| `state.*` | `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` |

Every descriptor origin must be an explicit loopback origin (`localhost`, `127.0.0.1`, or `::1`) with an `http`, `https`, `ws`, or `wss` scheme.

## Evidence and security

- The fixture descriptor is never uploaded as an artifact. It is deleted after a `clean` cleanup; when cleanup fails, the provider's leftovers are written to evidence as owned resource ids and the descriptor is kept so the cleanup token remains traceable.
- Request and result files are written atomically with mode `0600` inside a mode `0700` run directory.
- Evidence rejects access/session/auth/cleanup token, cookie, authorization, API-key, password, secret, credential, private-key, and private-descriptor field names at any depth, plus bearer/basic/JWT/private-key value shapes. Bare `token`/`tokens` fields are allowed when their values are not secret-shaped so non-secret counters and transcript markers remain reportable.
- Rejected evidence is not persisted verbatim; the coordinator writes a sanitized failure report instead.
- Artifact paths must be relative and contained in the run directory.
- Run ids must be a single safe path segment. The run directory is claimed with a non-recursive create, so a reused id fails with a `config` error and concurrent runs with the same id cannot share request/result files.

## Consumers

Cloud and IDE consumers should implement against `schema/*.v<version>.json` rather than importing this package's runtime. The schemas are the stable wire contract; any breaking field change requires a new schema version and a new generated document.
