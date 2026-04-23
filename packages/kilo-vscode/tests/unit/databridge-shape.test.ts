import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Static guard against the perf regression fixed in this PR.
 *
 * PROBLEM (original bug):
 *   The webview's DataBridge wrapped the entire Data shape in
 *   `createMemo(() => ({ session, message, part, ... }))`, which
 *   re-runs whenever any dependency changes. Because the memo body
 *   read `store.parts[msg.id]` for every message in the session family
 *   (via `sessionFamily()`), a single token delta invalidated the memo
 *   → produced a fresh POJO → invalidated every downstream consumer
 *   that read `data.store.*`, including O(N) scans in every mounted
 *   SessionTurn. CPU profile showed ~46% of streaming main-thread time
 *   in Solid reactive work with this pattern.
 *
 * FIX:
 *   Expose `data` as a plain object with reactive getters over the
 *   underlying Solid stores. Consumers reading `data.store.part[Y]`
 *   now subscribe to only that specific key, so a text-delta on
 *   message Y only invalidates consumers that read part[Y] — not the
 *   whole tree.
 *
 * This static test catches any future change that re-introduces the
 * buggy pattern. For the matching runtime reactivity assertion, see
 * `tests/webview-reactivity/databridge-reactivity.test.ts`.
 */
describe("DataBridge shape (perf regression guard)", () => {
  const path = join(__dirname, "..", "..", "webview-ui", "src", "App.tsx")
  const src = readFileSync(path, "utf8")

  it("DataBridge exists in App.tsx", () => {
    expect(src).toMatch(/export const DataBridge/)
  })

  it("`data` is not wrapped in createMemo(() => ({ ...message, ...part }))", () => {
    // Extract the DataBridge function body up to its return statement.
    const match = src.match(/export const DataBridge[\s\S]*?return \(\s*<DataProvider/)
    expect(match).toBeTruthy()
    const body = match![0]

    // Buggy pattern: a createMemo whose body returns an object containing
    // both `message:` and `part:` keys. That breaks per-key reactivity
    // because the memo itself invalidates on any store mutation.
    const badPattern = /const\s+data\s*=\s*createMemo\s*\([^)]*\)\s*=>\s*\(\s*\{[\s\S]*?\bmessage\s*:[\s\S]*?\bpart\s*:/
    expect(body).not.toMatch(badPattern)
  })

  it("`data` uses reactive getters, not value-returning props", () => {
    const match = src.match(/const\s+data\s*=\s*\{[\s\S]*?\n\s*\}\s*\n/)
    expect(match).toBeTruthy()
    const block = match![0]

    // The fix relies on per-field getters so each consumer access is
    // reactive independently. Require getters for `message` and `part`.
    expect(block).toMatch(/get\s+message\s*\(\s*\)\s*\{/)
    expect(block).toMatch(/get\s+part\s*\(\s*\)\s*\{/)
  })
})
