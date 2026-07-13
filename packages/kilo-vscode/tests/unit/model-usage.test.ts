import { describe, expect, test } from "bun:test"
import type { Provider, SessionModelUsage } from "../../webview-ui/src/types/messages"
import {
  formatCost,
  formatSummaryCost,
  groupModelUsage,
  hasModelUsage,
  isSameSessionTree,
  modelUsageName,
  summaryCost,
  tokenSummary,
} from "../../webview-ui/src/context/model-usage"

const tokens = { input: 10, output: 2, reasoning: 1, cache: { read: 20, write: 5 } }
const models = [
  { providerID: "kilo", modelID: "qwen/qwen3.7-plus-20260602", steps: 1, cost: 0.01, tokens },
  { providerID: "minimax", modelID: "minimax-m3", steps: 1, cost: 0.02, tokens },
]
const usage = {
  sessionIDs: ["root", "child"],
  totals: { steps: 2, cost: 0.03, tokens },
  models,
} satisfies SessionModelUsage
const providers = {
  kilo: {
    id: "kilo",
    name: "Kilo Gateway",
    models: {
      "qwen/qwen3.7-plus": { id: "qwen/qwen3.7-plus", name: "Qwen: Qwen3.7 Plus (20% off)" },
    },
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    models: { "minimax-m3": { id: "minimax-m3", name: "MiniMax M3" } },
  },
} satisfies Record<string, Provider>
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

describe("model usage", () => {
  test("formats detailed model costs with precision", () => {
    expect(formatCost(0.270162, money)).toBe("$0.270162")
    expect(formatCost(0.0000001, money)).toBe("<$0.000001")
    expect(formatCost(Number.NaN, money)).toBe("$0.00")
  })

  test("formats summary costs as dollars and cents", () => {
    expect(formatSummaryCost(0.270162, "en-US")).toBe("$0.27")
    expect(formatSummaryCost(1_234_567.899, "en-US")).toBe("$1,234,567.90")
    expect(formatSummaryCost(Number.NaN, "en-US")).toBe("$0.00")
  })

  test("uses message costs only for cloud previews", () => {
    const fallback = [{ cost: 0.17 }, { cost: 0.1 }]
    let reads = 0
    const read = () => {
      reads++
      return fallback
    }
    expect(summaryCost("local", usage, read)).toBe(0.03)
    expect(summaryCost("local", undefined, read)).toBeUndefined()
    expect(reads).toBe(0)
    expect(summaryCost("cloud:preview", undefined, read)).toBe(0.27)
    expect(reads).toBe(1)
  })

  test("groups billing routes and resolves compact catalog names", () => {
    expect(hasModelUsage(usage)).toBeTrue()
    expect(
      hasModelUsage({
        sessionIDs: [],
        totals: { steps: 0, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        models: [],
      }),
    ).toBeFalse()
    expect(tokenSummary(usage)).toEqual({ input: 10, output: 2, cached: 20 })
    expect(groupModelUsage(models, providers).map((group) => group.providerName)).toEqual(["Kilo Gateway", "MiniMax"])
    expect(modelUsageName(models[0], providers)).toBe("Qwen 3.7 Plus")
    expect(modelUsageName(models[1], providers)).toBe("MiniMax M3")
    expect(modelUsageName({ ...models[0], modelID: "moonshotai/kimi-k2.7-code-20260612" }, {})).toBe("kimi-k2.7-code")
    // Routed free-variant ids keep their name instead of collapsing to the ":free" suffix
    expect(modelUsageName({ ...models[0], modelID: "tencent/hy3:free" }, {})).toBe("hy3:free")
  })

  test("matches sessions through their top-level tree", () => {
    const sessions = new Map([
      ["root", {}],
      ["child", { parentID: "root" }],
      ["sibling", { parentID: "root" }],
      ["other", {}],
    ])
    const get = (id: string) => sessions.get(id)

    expect(isSameSessionTree("child", "sibling", get)).toBeTrue()
    expect(isSameSessionTree("child", "new", get, "sibling")).toBeTrue()
    expect(isSameSessionTree("child", "other", get)).toBeFalse()
  })
})
