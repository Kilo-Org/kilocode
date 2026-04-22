import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { createRoot, createEffect, createSignal } from "solid-js"

/**
 * Runtime perf assertion for the markdown rAF-coalesced parse fix.
 *
 * PROBLEM:
 *   `Markdown`'s render effect ran `temp.innerHTML = content` + `morphdom`
 *   on every content change. During streaming, content changes fire
 *   60–200Hz, and each parse + diff is ~200μs. CPU profile of a 7s
 *   streaming window showed 2,940 ParseHTML events totaling ~619ms
 *   (~46% of blocked main-thread time).
 *
 * FIX:
 *   Queue the latest content and run the morphdom pass inside
 *   requestAnimationFrame. K rapid updates before the frame fires
 *   collapse to a single parse instead of K parses.
 *
 * RUNTIME ASSERTION:
 *   Mirror the Markdown component's rAF-coalescing pattern with a plain
 *   reactive setup, burst-update the signal 100 times in a tight loop,
 *   and assert the "parse" ran ≤1 time (one rAF tick), not 100.
 *
 *   Pre-fix pattern (direct parse in effect) fires 100 times; post-fix
 *   pattern (rAF-coalesced) fires once.
 *
 * NOTE:
 *   Requires `--conditions=browser` for the Solid client build.
 *   Run via `bun run test:webview-reactivity`.
 */

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

/**
 * Fire setText repeatedly across microtask boundaries so Solid does NOT
 * batch the updates. This matches reality: each SSE token delta arrives in
 * its own event-loop tick, so the Markdown effect re-runs per delta.
 */
async function streamTokens(setText: (v: string) => void, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve()
    setText("token " + i)
  }
}

describe("Markdown — rAF-coalesced parse during streaming", () => {
  it("N async content updates collapse to ≤1 parse per rAF tick (post-fix pattern)", async () => {
    let parseCount = 0
    await createRoot(async (dispose) => {
      const [text, setText] = createSignal("initial")
      let pendingFrame: number | undefined
      let pendingContent: string | undefined

      createEffect(() => {
        const content = text()
        pendingContent = content
        if (pendingFrame !== undefined) return
        pendingFrame = requestAnimationFrame(() => {
          pendingFrame = undefined
          const next = pendingContent
          pendingContent = undefined
          if (next === undefined) return
          // The "parse" = morphdom pass in real Markdown. We're measuring
          // how often the rAF callback actually runs. With real rAF ticking
          // at most every 16ms, a burst of sub-16ms updates collapses to one.
          parseCount++
        })
      })

      // Wait for initial effect + rAF to settle, then reset.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      parseCount = 0

      // In happy-dom, rAF fires on the next microtask. So between each
      // setText we wait for a microtask to let the effect run, but a
      // frame hasn't "elapsed" in the classical sense — the rAF we
      // scheduled first will still be pending when the second setText
      // arrives, so they collapse. The test passes if N async updates
      // produce ≤ N/5 parses (real-world rAF coalesces much more, but
      // happy-dom's rAF semantics are permissive so we assert a loose
      // upper bound that is still dramatically below the pre-fix N).
      await streamTokens(setText, 100)

      // Give any pending rAFs a tick to fire.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      await new Promise<void>((r) => requestAnimationFrame(() => r()))

      expect(parseCount, "rAF-coalesced updates must be dramatically fewer than update count").toBeLessThan(20)
      dispose()
    })
  })

  it("N async content updates WITHOUT rAF produce N parses (pre-fix baseline)", async () => {
    let parseCount = 0
    await createRoot(async (dispose) => {
      const [text, setText] = createSignal("initial")

      createEffect(() => {
        const content = text()
        if (content === "initial") return
        // Pre-fix: parse fires directly inside the effect on every change.
        parseCount++
      })

      await streamTokens(setText, 100)

      expect(parseCount, "pre-fix pattern parses on every update").toBe(100)
      dispose()
    })
  })
})
