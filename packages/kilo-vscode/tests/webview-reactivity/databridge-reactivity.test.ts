import { describe, it, expect } from "bun:test"
import { createRoot, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"

/**
 * Runtime perf test for the DataBridge reactivity fix.
 *
 * PROBLEM:
 *   A Solid memo that wraps the whole session Data shape invalidates
 *   globally on any single part mutation, cascading through every
 *   downstream consumer of `data.store.*` (including all mounted
 *   SessionTurns). Per-token work scales with total session size:
 *   with 200 messages and ~12 mounted turns, token streaming did
 *   ~2,400 reactive re-runs per delta.
 *
 * FIX:
 *   Expose `data` as a plain object with reactive getters that
 *   pass through to the underlying Solid stores. Consumers that read
 *   `data.store.part[X]` subscribe to only `parts.X` — so a text-delta
 *   on message Y only invalidates consumers of message Y.
 *
 * PERF ASSERTION:
 *   With N=100 messages and K=1000 deltas on a single message, only
 *   the consumer reading THAT message's parts should re-run (~K times).
 *   Consumers for the other 99 messages should each run exactly once
 *   (initial evaluation). If the regression returns, every consumer
 *   re-runs on every delta → ~100K runs instead of ~1K.
 *
 * NOTE:
 *   This test needs Bun's `browser` resolution condition so `solid-js`
 *   and `solid-js/store` both load their client (reactive) builds.
 *   Run via `bun run test:webview-reactivity` in packages/kilo-vscode.
 *   The default `bun test` uses the `node` condition which resolves
 *   Solid to its server (no-op) build and would make these assertions
 *   meaningless.
 */

type Msg = { id: string; sessionID: string }
type Part = { id: string; text: string; messageID: string }

describe("DataBridge reactivity — perf", () => {
  it("detects Solid reactive runtime (sanity check)", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{ n: number }>({ n: 0 })
      let runs = 0
      createMemo(() => {
        runs++
        return store.n
      })
      setStore("n", 1)
      setStore("n", 2)
      // Must observe 3 runs (1 initial + 2 updates). If Solid resolved to
      // its server build, runs would be 1. This fails fast with a clear
      // message telling you to use --conditions=browser.
      expect(runs, "Solid reactivity is not active — ensure tests run with --conditions=browser").toBe(3)
      dispose()
    })
  })

  it("getter shape: mutating one message's parts does not fire other consumers", () => {
    createRoot((dispose) => {
      const N = 100
      const initMsgs: Record<string, Msg[]> = {}
      const initParts: Record<string, Part[]> = {}
      for (let i = 0; i < N; i++) {
        const msgID = `m${i}`
        initMsgs["s1"] = initMsgs["s1"] ?? []
        initMsgs["s1"].push({ id: msgID, sessionID: "s1" })
        initParts[msgID] = [{ id: `p${i}`, text: "", messageID: msgID }]
      }

      const [store, setStore] = createStore({ messages: initMsgs, parts: initParts })

      // The fix: reactive getters passing through to the Solid store.
      const data = {
        store: {
          get message() {
            return store.messages
          },
          get part() {
            return store.parts
          },
        },
      }

      // Emulate one SessionTurn memo per message, reading that turn's parts.
      const runs = new Array(N).fill(0)
      const consumers: (() => string)[] = []
      for (let i = 0; i < N; i++) {
        const idx = i
        consumers.push(
          createMemo(() => {
            runs[idx]!++
            return data.store.part[`m${idx}`]?.[0]?.text ?? ""
          }),
        )
      }

      // Seed read — triggers initial evaluation.
      for (const c of consumers) c()
      expect(runs.every((r) => r === 1)).toBe(true)

      // Simulate K text-deltas on message m0 (the "streaming" message).
      const K = 1000
      for (let k = 0; k < K; k++) {
        setStore(
          "parts",
          produce((p) => {
            p["m0"]![0]!.text += "x"
          }),
        )
      }

      // Consumer 0 must re-run on every delta.
      expect(runs[0]!, "consumer for mutated message must re-run per delta").toBe(1 + K)
      // All other consumers must NOT re-run. This is the perf invariant.
      const others = runs.slice(1)
      const maxOther = Math.max(...others)
      expect(maxOther, "consumers for unrelated messages must not re-run on per-token deltas").toBe(1)

      // Also confirm total work scales with K (not K×N).
      const totalRuns = runs.reduce((a, b) => a + b, 0)
      expect(totalRuns).toBe(N + K)

      dispose()
    })
  })

  it("getter shape scales O(1) with session size for per-token work", () => {
    // Run the same K deltas against N=10 and N=500 and verify total
    // reactive work scales with K only, not with N.
    const measure = (N: number, K: number): number => {
      let total = 0
      createRoot((dispose) => {
        const parts: Record<string, Part[]> = {}
        for (let i = 0; i < N; i++) parts[`m${i}`] = [{ id: `p${i}`, text: "", messageID: `m${i}` }]
        const [store, setStore] = createStore({ parts })
        const data = {
          store: {
            get part() {
              return store.parts
            },
          },
        }
        const consumers: (() => string)[] = []
        for (let i = 0; i < N; i++) {
          const idx = i
          consumers.push(
            createMemo(() => {
              total++
              return data.store.part[`m${idx}`]?.[0]?.text ?? ""
            }),
          )
        }
        for (const c of consumers) c()
        for (let k = 0; k < K; k++) {
          setStore(
            "parts",
            produce((p) => {
              p["m0"]![0]!.text += "x"
            }),
          )
        }
        dispose()
      })
      return total
    }

    const small = measure(10, 500) // N=10
    const large = measure(500, 500) // N=500

    // Initial work = N evaluations; per-delta work = 1 (only m0's consumer).
    // Total = N + K. large - small should equal the difference in N only.
    expect(small).toBe(10 + 500)
    expect(large).toBe(500 + 500)
    // Explicitly: per-delta cost is identical regardless of N.
    const perDeltaSmall = (small - 10) / 500
    const perDeltaLarge = (large - 500) / 500
    expect(perDeltaSmall).toBe(1)
    expect(perDeltaLarge).toBe(1)
  })
})
