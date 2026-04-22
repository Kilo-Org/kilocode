import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

/**
 * Runtime perf assertion for the TextShimmer JS-timer fix.
 *
 * PROBLEM:
 *   A createEffect inside TextShimmer called clearTimeout + setTimeout on
 *   every `active` prop change. During streaming, tool states thrashed
 *   `pending()` / `running()` accessors, firing thousands of timer calls
 *   per second (CPU profile: ~2,500 timer calls in 1.3s of blocked time,
 *   ~16% of blocked main-thread time).
 *
 * FIX:
 *   Remove the effect entirely. The shimmer animation is now gated on the
 *   `data-active` attribute via CSS — no JS timer needed.
 *
 * RUNTIME ASSERTION:
 *   Mount TextShimmer with a reactive `active` prop, toggle it 1,000 times
 *   at the rate seen during streaming, and assert that zero setTimeout and
 *   zero clearTimeout calls were issued. Pre-fix this would have produced
 *   ~500 setTimeout calls from the component's effect.
 *
 * NOTE:
 *   Requires Bun's `browser` resolution condition so `solid-js` and
 *   `solid-js/web` load their client builds. Run via
 *   `bun run test:webview-reactivity` from packages/kilo-vscode/.
 */

// happy-dom provides document / HTMLElement / querySelector — required so
// solid-js/web's `render` has a real DOM to mount into.
beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe("TextShimmer — no JS timers during prop thrash", () => {
  it("toggling `active` 1000 times produces zero setTimeout/clearTimeout calls", async () => {
    // Patch global timers with counting spies BEFORE importing the
    // component, so any module-level timer scheduling would be caught.
    const origSetTimeout = globalThis.setTimeout
    const origClearTimeout = globalThis.clearTimeout
    let setTimeoutCount = 0
    let clearTimeoutCount = 0
    globalThis.setTimeout = ((...args: Parameters<typeof origSetTimeout>) => {
      setTimeoutCount++
      return origSetTimeout(...args)
    }) as typeof origSetTimeout
    globalThis.clearTimeout = ((...args: Parameters<typeof origClearTimeout>) => {
      clearTimeoutCount++
      return origClearTimeout(...args)
    }) as typeof origClearTimeout

    try {
      const { TextShimmer } = await import("../../../ui/src/components/text-shimmer")
      const { render } = await import("solid-js/web")
      const { createSignal } = await import("solid-js")

      const [active, setActive] = createSignal(true)
      const container = document.createElement("div")
      document.body.appendChild(container)

      // Reactive props via getter: TextShimmer's internal createMemo
      // subscribes to `active()` through the getter, so each setActive()
      // update propagates as a real prop change — the exact scenario the
      // pre-fix effect overreacted to.
      const dispose = render(
        () =>
          TextShimmer({
            text: "streaming",
            get active() {
              return active()
            },
          }),
        container,
      )

      // Reset counters so we only measure the prop-thrash phase, not
      // the render setup.
      setTimeoutCount = 0
      clearTimeoutCount = 0

      // Thrash `active` at the rate seen during real long-session streaming
      // (tool pending/running flips cascading through the subtree).
      for (let i = 0; i < 1000; i++) setActive(i % 2 === 0)

      expect(setTimeoutCount, "TextShimmer must not schedule setTimeout on prop change").toBe(0)
      expect(clearTimeoutCount, "TextShimmer must not call clearTimeout on prop change").toBe(0)

      dispose()
      document.body.removeChild(container)
    } finally {
      globalThis.setTimeout = origSetTimeout
      globalThis.clearTimeout = origClearTimeout
    }
  })
})
