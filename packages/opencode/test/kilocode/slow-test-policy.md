# Slow CLI test policy

This file records test cases intentionally excluded from Kilo's default CLI unit suite after profiling on June 10, 2026. Durations are local baseline measurements and are included to explain the relative cost, not to define performance assertions.

The policy is to preserve production timeout and retry behavior. We do not shorten test timeouts or production delays to make CI faster because that reduces scheduling margin and can introduce flakes. A slow test is removed only when focused coverage exists elsewhere, or retained for explicit execution when it provides unique stress coverage.

## Excluded files

These upstream files remain unchanged so regular upstream merges do not produce modify/delete conflicts. `script/test-runner.ts` excludes them only from an unfiltered default run. Passing a matching pattern runs them explicitly.

| Test | Baseline | Disposition | Reason | Explicit command |
|---|---:|---|---|---|
| `mcp/oauth-browser.test.ts` | Not profiled | Ignore by default | Uses a fixed OAuth callback port and races with parallel OAuth tests. | `bun run script/test-runner.ts mcp/oauth-browser` |
| `plugin/install-concurrency.test.ts` | 9.2s total | Ignore by default | The three stress cases spawn 30 Bun processes and spend most of their time in process startup and lock backoff. They remain useful for targeted changes to plugin config locking. | `bun run script/test-runner.ts plugin/install-concurrency` |

The plugin concurrency file contains these cases:

- `serializes concurrent server config updates across processes`
- `serializes concurrent server+tui config updates across processes`
- `preserves updates when existing config uses .json`

## Removed cases

These cases were removed from shared test files. Their production behavior and timeouts are unchanged.

| Test | Origin | Baseline | Why removed | Remaining coverage |
|---|---|---:|---|---|
| `converts ECONNRESET socket errors to retryable APIError` | Upstream | 8.01s | Waited for Bun's eight-second idle socket timeout to manufacture `ECONNRESET`. | `ECONNRESET socket error is retryable` still verifies retry classification and metadata handling. The Bun-specific conversion path is no longer covered. |
| `times out with the requested fence in the error message` | Upstream | 5.23s | Waited for the full five-second production workspace timeout to inspect its message. | Immediate, event-driven, cross-workspace, and abort paths remain covered. The timeout diagnostic string is no longer covered. |
| `times out hanging plugin cleanup on dispose` | Upstream | 5.22s | Registered a cleanup promise that never settles and waited for the full five-second production disposal timeout. | Normal plugin initialization and cleanup remain covered. The disposal timeout branch is no longer covered. |
| `session.processor effect tests retry recognized structured json errors` | Upstream | 2.85s | Paid the real production retry backoff in an integration test. | Structured `too_many_requests` parsing and retry-policy behavior remain covered in `session/retry.test.ts`. Processor continuation after a retry is no longer covered. |
| `session.processor effect tests publish retry status updates` | Upstream | 2.63s | Paid the same production retry backoff to observe one bus event. | Retry status generation and attempt increments remain covered by the retry-policy test. Processor-to-bus publication is no longer covered. |
| `cancel persists aborted shell result when shell ignores TERM` | Kilo-marked shared test | 3.42s | Deliberately ignored `SIGTERM`, forcing the full three-second production escalation delay. | Adjacent prompt tests cover cancellation and persisted output. `packages/core/test/effect/cross-spawn-spawner.test.ts` covers forced `SIGKILL` escalation with a focused process test. |

## Consolidated Kilo daemon cases

The following Kilo-owned cases launched separate full daemon processes. Their assertions now run inside `starts, reuses, authenticates, and stops a daemon` so one daemon lifecycle covers all behavior:

- `reuses one daemon across caller directories`
- `daemon client honors the escape hatch`
- `daemon client returns authenticated attach settings`

The lifecycle no longer performs a second daemon startup after stopping. Initial startup and shutdown remain covered, but restart-after-stop is not independently asserted.

## Profile impact

| Measurement | Baseline | Updated | Difference | Time saved |
|---|---:|---:|---:|---:|
| Local CLI suite | 242.9s | 221.7s | -21.2s | 8.7% |
| Linux CI CLI JUnit duration | 248.0s | 226.6s | -21.4s | 8.6% |
| Linux CI `Run unit tests` step | 258s | 237s | -21s | 8.1% |
| Windows CI CLI JUnit duration | 709.9s | 784.0s | +74.1s | -10.4% |
| Windows CI `Run unit tests` step | 722s | 799s | +77s | -10.7% |

The local and Linux CI measurements consistently save about 21 seconds. The first Windows CI comparison was green but slower overall despite removing approximately 30 seconds of deterministic waits on that platform. Per-test timing shows unrelated Windows tests varied upward enough to outweigh those removals, so a single Windows run does not demonstrate a pipeline speedup. The comparison uses PR run [27265656392](https://github.com/Kilo-Org/kilocode/actions/runs/27265656392) and the immediately preceding successful `main` run [27262711220](https://github.com/Kilo-Org/kilocode/actions/runs/27262711220).

Revisit an exclusion when upstream replaces a real-time wait with deterministic clock control, removes redundant process startup, or otherwise makes the case fast without reducing scheduling margin.
