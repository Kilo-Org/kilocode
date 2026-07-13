# Config Regression Re-review: PR #12088

## Second-pass verdict

**Reviewed head:** `b42f911f7680559b536850aab414258d0eb59a88`

**Current `origin/main`:** `6639022345dd0966b6e028f2c7e533ab91e97166`

**Merge base:** `be15cf4b556bea96aaef6de1b3c405b86c0d1a6c`

**Pass with follow-up.** No shipped Kilo config regression remains. The experimental core v2 registries still use `.opencode` discovery and omit Kilo roots/environment semantics, but no first-party Kilo client consumes those agent, command, or skill endpoints, and `kilo serve` does not mount v2 routes.

## Follow-up: align core v2 discovery before adoption

`packages/core/src/config.ts` recognizes OpenCode filenames and discovers `.opencode`, with no `.kilo`, `.kilocode`, or Kilo environment controls. The command, agent, and skill plugins scan those emitted directories and are exposed in the private experimental v2 API.

Production-source searches found no first-party use of `client.v2.agent`, `client.v2.command`, or `client.v2.skill`. VS Code, TUI, ACP, and Console continue to use stable `/agent`, `/command`, and `/skill` methods backed by the Kilo-aware v1 loader. The active network listener also omits `v2Routes` in `createListenerRoutes()`.

Before mounting or adopting these registries, make v2 discovery honor `.kilocode`/`.kilo` precedence, ignore `.opencode` directories, and support `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, `KILO_CONFIG_DIR`, and `KILO_DISABLE_PROJECT_CONFIG`. Add focused tests for those semantics.

## Cleared checks

- The active v1 loader still discovers `.kilocode` then `.kilo`; `.kilo` wins at the same level.
- No `.opencode` directory fallback was restored in the active loader. Detection code only emits migration guidance.
- Legacy `opencode.json` filename support inside Kilo roots remains compatibility behavior, not directory fallback.
- Primary/active worktree ordering and explicit Kilo environment source precedence remain intact.

## Commands and limitations

The review used exact-ref path/environment searches, loader precedence comparison, generated SDK route mapping, client call-site searches, and listener route assembly. Static searches cannot identify third-party users of private/experimental APIs, but establish that current first-party products do not adopt the mismatched registries. No live config-loading test was run against the immutable ref.
