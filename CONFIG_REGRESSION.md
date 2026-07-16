# Config Regression Review: PR #12204, Fourth Pass

Audited PR HEAD `627be20ed6ceb589316df9b54a2ae398146fd684` against actual merge base `e084ab7492eb6f330768157663b29c347dc0fa18`.

## Finding

### High: effective reference config is not a runtime initialization invariant

Reference parsing and endpoint reconciliation are correct, but effective Kilo references are synchronized only when `/api/reference` runs. Agent permissions, system prompts, V2 guidance, and named-reference tools can consume provisional Core state first or never invoke the endpoint.

This is a configuration propagation regression for account, managed, inline, and other stable-only sources. Move reconciliation to shared location initialization and await it from every consumer rather than attaching it to one read endpoint.

## Verified Fixes

- Reference listing awaits reconciliation and preserves `description` and `hidden`.
- Direct first-request coverage verifies `KILO_CONFIG_CONTENT` endpoint semantics.
- Local references remain worktree-relative.
- Core discovery ignores `.opencode`, accepts `.kilo` and `.kilocode`, and gives `.kilo` intended precedence.
- `mcp add` honors `KILO_CONFIG_DIR`; subprocess coverage proves the default profile remains untouched.
- Stable and reconciled paths use the same effective `references` fallback.

There is no config schema, parsing, or migration regression. The remaining issue is when effective configuration becomes visible to runtime consumers.

This was a read-only Git-object audit; exact-head required CI passes.
