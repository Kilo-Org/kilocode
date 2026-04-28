# Security

Security-sensitive changes need explicit boundary validation, reviewable threat assumptions, and tests that exercise failure modes.

## Baseline Expectations

- Validate external data at boundaries with structured schemas.
- Do not build on guessed JSON shapes when a typed SDK or parser is available.
- Do not swallow errors silently.
- Do not log secrets, tokens, API keys, or auth headers.
- Prefer least-privilege permissions in GitHub Actions.
- Avoid new network calls in tests unless the test is explicitly integration-scoped.
- Document trust models for registry, marketplace, install, auth, or signing changes.

## Sensitive Areas

- `packages/devil-gateway/`
- `packages/devil-telemetry/`
- Auth and provider setup in `packages/opencode/`
- Team registry, install, publish, and manifest verification flows
- GitHub Actions with write permissions or secrets
- VS Code extension process spawning and workspace file access

## Review Bar

Security changes should include negative tests for malformed input, tampering, missing credentials, and permission failures where applicable.
