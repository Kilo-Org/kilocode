import { describe, expect, test } from "bun:test"
import type { Provider, SessionModelUsage } from "../../webview-ui/src/types/messages"
import {
  groupModelUsage,
  hasModelUsage,
  isSameSessionTree,
  modelUsageName,
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

describe("model usage", () => {
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
