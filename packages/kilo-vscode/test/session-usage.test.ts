import { describe, expect, test } from "bun:test"
import type {
  JsonValue,
  ModelInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client"
import {
  cacheRate,
  childLabels,
  collapseCostBreakdown,
  contextUsage,
  costBreakdown,
  fetchSessionMessages,
  findModel,
  groupModelsByProvider,
  latestModel,
  mergeModelUsage,
  modelLabel,
  modelUsage,
  sessionSubtree,
  sessionUsage,
  sumCost,
  sumTokens,
} from "../webview-ui/src/v2/session-usage"

const tokens = (input = 0, output = 0, reasoning = 0, read = 0, write = 0): TokenUsageInfo => ({
  input,
  output,
  reasoning,
  cache: { read, write },
})

const session = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  projectID: "project",
  cost: 0,
  tokens: tokens(),
  time: { created: 0, updated: 0 },
  location: { directory: "/work" },
  ...extra,
})

const user = (id: string): SessionMessageInfo => ({ type: "user", id, text: "hi", time: { created: 0 } })

const compaction = (id: string): SessionMessageInfo => ({
  type: "compaction",
  id,
  status: "completed",
  reason: "auto",
  summary: "summary",
  time: { created: 0 },
})

const assistant = (input: {
  id: string
  providerID?: string
  model?: string
  route?: string
  cost?: number
  tokens?: TokenUsageInfo
  content?: SessionMessageAssistant["content"]
}): SessionMessageAssistant => ({
  type: "assistant",
  id: input.id,
  agent: "build",
  model: { providerID: input.providerID ?? "kilo", id: input.model ?? "kilo-auto/frontier" },
  content: input.content ?? [],
  ...(input.route ? { native: { kilo: { routedModelID: input.route } } } : {}),
  ...(input.cost === undefined ? {} : { cost: input.cost }),
  ...(input.tokens === undefined ? {} : { tokens: input.tokens }),
  time: { created: 0, completed: 1 },
})

const childTool = (
  id: string,
  child: string | undefined,
  input: { [key: string]: string } = {},
  status: "completed" | "running" | "streaming" = "completed",
  name = "subagent",
): SessionMessageAssistantTool => {
  const tool = { type: "tool", id, name, time: { created: 0 } } as const
  if (status === "streaming") return { ...tool, state: { status: "streaming", input: "" } }
  const metadata: { [key: string]: JsonValue } = child === undefined ? {} : { sessionID: child }
  if (status === "running") return { ...tool, state: { status: "running", input, metadata } }
  return { ...tool, state: { status: "completed", input, metadata, content: [{ type: "text", text: "" }] } }
}

const catalogModel = (input: { id: string; providerID?: string; name?: string; context?: number }): ModelInfo => ({
  id: input.id,
  modelID: input.id,
  providerID: input.providerID ?? "kilo",
  name: input.name ?? input.id,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: input.context ?? 200000, output: 8000 },
})

describe("sessionSubtree", () => {
  test("keeps the viewed session and its descendants, not siblings", () => {
    const family = [
      session("root"),
      session("a", { parentID: "root" }),
      session("b", { parentID: "a" }),
      session("sibling", { parentID: "root" }),
      session("other", { parentID: "elsewhere" }),
    ]
    expect(sessionSubtree(family, "root").map((item) => item.id)).toEqual(["root", "a", "b", "sibling"])
    expect(sessionSubtree(family, "a").map((item) => item.id)).toEqual(["a", "b"])
    expect(sessionSubtree(family, "other").map((item) => item.id)).toEqual(["other"])
  })

  test("still returns descendants when the viewed session is absent from the family list", () => {
    const family = [session("a", { parentID: "missing" }), session("b", { parentID: "a" })]
    expect(sessionSubtree(family, "missing").map((item) => item.id)).toEqual(["a", "b"])
  })

  test("stops a parent cycle", () => {
    const family = [
      session("root"),
      session("a", { parentID: "b" }),
      session("b", { parentID: "a" }),
      session("x", { parentID: "y" }),
      session("y", { parentID: "x" }),
    ]
    expect(sessionSubtree(family, "root").map((item) => item.id)).toEqual(["root"])
    expect(sessionSubtree(family, "a").map((item) => item.id)).toEqual(["a", "b"])
  })

  test("sums tokens and cost over the subtree", () => {
    const members = [
      session("root", { cost: 0.5, tokens: tokens(10, 1, 2, 3, 4) }),
      session("a", { parentID: "root", cost: 0.25, tokens: tokens(5, 1, 0, 1, 0) }),
    ]
    expect(sumTokens(members)).toEqual(tokens(15, 2, 2, 4, 4))
    expect(sumCost(members)).toBeCloseTo(0.75)
  })
})

describe("costBreakdown", () => {
  test("drops zero-cost members, keeps the root first, then creation order", () => {
    const members = [
      session("c", { parentID: "a", cost: 0.1, time: { created: 3, updated: 3 } }),
      session("a", { parentID: "root", cost: 0.2, time: { created: 2, updated: 2 } }),
      session("root", { cost: 0.5, time: { created: 1, updated: 1 } }),
      session("b", { parentID: "a", cost: 0 }),
    ]
    const items = costBreakdown(members, new Map([["a", "Explore"]]), "root", "This session")
    expect(items).toEqual([
      { label: "This session", cost: 0.5 },
      { label: "Explore", cost: 0.2 },
      { label: "c", cost: 0.1 },
    ])
  })

  test("orders a newest-first family by creation time before the collapse", () => {
    const members = [
      session("new", { parentID: "root", cost: 0.3, time: { created: 30, updated: 30 } }),
      session("old", { parentID: "root", cost: 0.2, time: { created: 10, updated: 10 } }),
      session("root", { cost: 0.5, time: { created: 1, updated: 1 } }),
    ]
    const items = costBreakdown(members, new Map(), "root", "This session")
    expect(collapseCostBreakdown(items, (count) => `${count} older`).map((item) => item.label)).toEqual([
      "This session",
      "new",
      "old",
    ])
  })

  test("labels a child by the first 8 characters of its id when there is no label", () => {
    const items = costBreakdown([session("0123456789", { cost: 1 })], new Map(), "root", "This session")
    expect(items).toEqual([{ label: "01234567", cost: 1 }])
  })

  test("collapses children beyond 8 into one older-sessions line", () => {
    const children = Array.from({ length: 10 }, (_, index) => ({ label: `c${index}`, cost: 1 }))
    const collapsed = collapseCostBreakdown([{ label: "root", cost: 1 }, ...children], (count) => `${count} older`)
    expect(collapsed.map((item) => item.label)).toEqual([
      "root",
      "c9",
      "c8",
      "c7",
      "c6",
      "c5",
      "c4",
      "c3",
      "c2",
      "2 older",
    ])
    expect(collapsed.at(-1)?.cost).toBe(2)
  })

  test("keeps all children when there are 8 or fewer", () => {
    const collapsed = collapseCostBreakdown(
      [
        { label: "root", cost: 1 },
        { label: "a", cost: 1 },
        { label: "b", cost: 1 },
      ],
      (count) => `${count} older`,
    )
    expect(collapsed.map((item) => item.label)).toEqual(["root", "b", "a"])
  })
})

describe("contextUsage", () => {
  test("uses the last step after the last completed compaction", () => {
    const messages = [
      user("u1"),
      assistant({ id: "a1", tokens: tokens(10) }),
      compaction("c1"),
      assistant({ id: "a2", tokens: tokens(20, 5) }),
      assistant({ id: "a3", tokens: tokens(30) }),
    ]
    expect(contextUsage(messages, 1000)).toEqual({ tokens: 30, percentage: 3 })
  })

  test("stops at the revert boundary", () => {
    const messages = [
      user("u1"),
      assistant({ id: "a1", tokens: tokens(50) }),
      user("boundary"),
      assistant({ id: "a2", tokens: tokens(90) }),
    ]
    expect(contextUsage(messages, 1000, "boundary")).toEqual({ tokens: 50, percentage: 5 })
    expect(contextUsage(messages, 1000, "gone")).toBeUndefined()
  })

  test("returns undefined when the step has no tokens", () => {
    expect(contextUsage([assistant({ id: "a1", tokens: tokens() })], 1000)).toBeUndefined()
    expect(contextUsage([assistant({ id: "a2" })], 1000)).toBeUndefined()
    expect(contextUsage([user("u1")], 1000)).toBeUndefined()
  })

  test("rounds the percentage and omits it without a limit", () => {
    const messages = [assistant({ id: "a1", tokens: tokens(1) })]
    expect(contextUsage(messages, 3)).toEqual({ tokens: 1, percentage: 33 })
    expect(contextUsage(messages, undefined)).toEqual({ tokens: 1, percentage: null })
    expect(contextUsage(messages, 0)).toEqual({ tokens: 1, percentage: null })
  })
})

describe("latestModel", () => {
  test("returns the model of the last assistant message", () => {
    const messages: SessionMessageInfo[] = [
      user("u1"),
      assistant({ id: "a1", providerID: "openai", model: "gpt-5.4" }),
      assistant({ id: "a2", providerID: "kilo", model: "kilo-auto/frontier" }),
      user("u2"),
    ]
    expect(latestModel(messages)).toEqual({ providerID: "kilo", id: "kilo-auto/frontier" })
    expect(latestModel([user("u1")])).toBeUndefined()
  })
})

describe("findModel", () => {
  const models = [
    catalogModel({ id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", context: 200000 }),
    catalogModel({ id: "gpt-5.4", providerID: "openai", name: "GPT-5.4", context: 400000 }),
  ]

  test("finds an exact provider and id", () => {
    expect(findModel(models, { providerID: "openai", id: "gpt-5.4" })?.name).toBe("GPT-5.4")
  })

  test("finds a date-suffixed model id", () => {
    expect(findModel(models, { providerID: "kilo", id: "claude-sonnet-4.5-20250101" })?.name).toBe("Claude Sonnet 4.5")
    expect(findModel(models, { providerID: "kilo", id: "claude-sonnet-4.5-2025-01-01" })?.name).toBe(
      "Claude Sonnet 4.5",
    )
  })

  test("returns undefined for a missing model or catalog", () => {
    expect(findModel(models, { providerID: "kilo", id: "missing" })).toBeUndefined()
    expect(findModel(models, undefined)).toBeUndefined()
    expect(findModel(undefined, { providerID: "kilo", id: "gpt-5.4" })).toBeUndefined()
  })
})

describe("sessionUsage", () => {
  const models = [catalogModel({ id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", context: 200000 })]

  test("resolves the step model and its context usage", () => {
    const messages = [assistant({ id: "a1", model: "claude-sonnet-4.5", tokens: tokens(1000, 100, 0, 500, 0) })]
    const resolved = sessionUsage(messages, models, undefined)
    expect(resolved.model?.id).toBe("claude-sonnet-4.5")
    expect(resolved.usage?.tokens).toBe(1600)
    expect(resolved.usage?.percentage).toBe(1)
  })

  test("falls back to the session model", () => {
    const resolved = sessionUsage([], models, { providerID: "kilo", id: "claude-sonnet-4.5" })
    expect(resolved.model?.id).toBe("claude-sonnet-4.5")
    expect(resolved.usage).toBeUndefined()
  })
})

describe("modelLabel", () => {
  test("strips the sub-provider prefix for kilo", () => {
    const models = [catalogModel({ id: "sonnet", name: "  Anthropic:   Claude Sonnet 4.5  " })]
    expect(modelLabel({ providerID: "kilo", id: "sonnet" }, models)).toBe("Claude Sonnet 4.5")
  })

  test("removes a trailing free marker and the date suffix", () => {
    const models = [catalogModel({ id: "gpt", providerID: "openai", name: "GPT-5 (Free)" })]
    expect(modelLabel({ providerID: "openai", id: "gpt" }, models)).toBe("GPT-5")
    expect(modelLabel({ providerID: "openai", id: "gpt-5.4-20250101" }, [])).toBe("gpt-5.4")
  })

  test("keeps the prefix for a non-kilo provider", () => {
    const models = [catalogModel({ id: "sonnet", providerID: "anthropic", name: "Anthropic: Claude" })]
    expect(modelLabel({ providerID: "anthropic", id: "sonnet" }, models)).toBe("Anthropic: Claude")
  })
})

describe("childLabels", () => {
  test("reads the child session id from the subagent tool metadata", () => {
    const parent = [
      assistant({
        id: "a1",
        content: [
          childTool("t1", "child-1", { description: "Explore the parser" }),
          childTool("t2", "child-2", { agent: "explore" }),
          childTool("t3", "child-3"),
          childTool("t4", undefined, { description: "No session yet" }),
          childTool("t5", "child-5", { description: "Streaming" }, "streaming"),
        ],
      }),
    ]
    const labels = childLabels([parent])
    expect(labels.get("child-1")).toBe("Explore the parser")
    expect(labels.get("child-2")).toBe("explore")
    expect(labels.get("child-3")).toBe("subagent")
    expect(labels.has("child-5")).toBe(false)
    expect(labels.size).toBe(3)
  })

  test("also reads the v1 task tool name", () => {
    const parent = [
      assistant({
        id: "a1",
        content: [childTool("t1", "child-1", { description: "Old task" }, "completed", "task")],
      }),
    ]
    const labels = childLabels([parent])
    expect(labels.get("child-1")).toBe("Old task")
  })

  test("keeps the first label and caps it at 24 characters", () => {
    const long = "x".repeat(40)
    const parent = [assistant({ id: "a1", content: [childTool("t1", "child-1", { description: long })] })]
    const other = [assistant({ id: "a2", content: [childTool("t2", "child-1", { description: "later" })] })]
    const label = childLabels([parent, other]).get("child-1") ?? ""
    expect(label).toBe(`${"x".repeat(23)}…`)
    expect(label.length).toBe(24)
  })
})

describe("modelUsage", () => {
  const step = (input: {
    id: string
    providerID: string
    model: string
    route?: string
    cost?: number
    tokens?: boolean
  }) =>
    assistant({
      id: input.id,
      providerID: input.providerID,
      model: input.model,
      route: input.route,
      cost: input.cost,
      tokens: input.tokens === false ? undefined : tokens(100, 20, 5, 300, 10),
    })

  test("counts each step under its routed model, sorted by cost", () => {
    const usage = modelUsage([
      user("msg_user"),
      step({
        id: "a",
        providerID: "kilo",
        model: "kilo-auto/frontier",
        route: "anthropic/claude-sonnet-4.6",
        cost: 0.2,
      }),
      step({
        id: "b",
        providerID: "kilo",
        model: "kilo-auto/frontier",
        route: "anthropic/claude-sonnet-4.6",
        cost: 0.1,
      }),
      step({ id: "c", providerID: "kilo", model: "kilo-auto/frontier", route: "openai/gpt-5.4", cost: 0.4 }),
      step({ id: "d", providerID: "openai", model: "gpt-5.4", cost: 0.05 }),
      // A running step without tokens is not a completed step.
      step({ id: "e", providerID: "openai", model: "gpt-5.4", cost: 1, tokens: false }),
    ])
    expect(usage.models.map((row) => [row.providerID, row.modelID, row.steps, Number(row.cost.toFixed(2))])).toEqual([
      ["kilo", "openai/gpt-5.4", 1, 0.4],
      ["kilo", "anthropic/claude-sonnet-4.6", 2, 0.3],
      ["openai", "gpt-5.4", 1, 0.05],
    ])
    expect(usage.models[1].tokens).toEqual(tokens(200, 40, 10, 600, 20))
    expect(usage.totals.steps).toBe(4)
    expect(usage.totals.cost).toBeCloseTo(0.75)
    expect(usage.totals.tokens.cache.read).toBe(1200)
  })

  test("ties sort by provider and model, and a missing or negative cost counts as zero", () => {
    const usage = modelUsage([
      step({ id: "a", providerID: "zai", model: "glm-5" }),
      step({ id: "b", providerID: "anthropic", model: "opus" }),
      step({ id: "c", providerID: "anthropic", model: "haiku", cost: -1 }),
    ])
    expect(usage.models.map((row) => `${row.providerID}/${row.modelID}`)).toEqual([
      "anthropic/haiku",
      "anthropic/opus",
      "zai/glm-5",
    ])
    expect(usage.totals.cost).toBe(0)
  })

  test("ignores a routed id equal to the model id", () => {
    const usage = modelUsage([
      step({ id: "a", providerID: "kilo", model: "kilo-auto/frontier", route: "kilo-auto/frontier" }),
    ])
    expect(usage.models.map((row) => row.modelID)).toEqual(["kilo-auto/frontier"])
  })
})

describe("mergeModelUsage", () => {
  test("merges the same model across members and sorts by cost", () => {
    const merged = mergeModelUsage([
      [
        { providerID: "kilo", modelID: "a", steps: 1, cost: 0.2, tokens: tokens(10, 1) },
        { providerID: "kilo", modelID: "b", steps: 1, cost: 0.4, tokens: tokens(20, 2) },
      ],
      [{ providerID: "kilo", modelID: "a", steps: 2, cost: 0.1, tokens: tokens(30, 3) }],
    ])
    expect(merged.map((row) => [row.modelID, row.steps, Number(row.cost.toFixed(2))])).toEqual([
      ["b", 1, 0.4],
      ["a", 3, 0.3],
    ])
    expect(merged[1].tokens).toEqual(tokens(40, 4))
  })
})

describe("groupModelsByProvider and cacheRate", () => {
  test("groups rows by provider in row order with the provider name", () => {
    const usage = modelUsage([
      assistant({ id: "a", providerID: "kilo", model: "a", cost: 3, tokens: tokens(1) }),
      assistant({ id: "b", providerID: "openai", model: "b", cost: 2, tokens: tokens(1) }),
      assistant({ id: "c", providerID: "kilo", model: "c", cost: 1, tokens: tokens(1) }),
    ])
    expect(
      groupModelsByProvider(usage.models, [{ id: "kilo", name: "Kilo Gateway" }]).map((group) => [
        group.providerName,
        group.models.map((row) => row.modelID),
      ]),
    ).toEqual([
      ["Kilo Gateway", ["a", "c"]],
      ["openai", ["b"]],
    ])
  })

  test("reports the cache read share or a dash", () => {
    expect(cacheRate(tokens(100, 0, 0, 300, 0))).toBe("75.0%")
    expect(cacheRate(tokens(0, 5, 0, 0, 0))).toBe("-")
    expect(cacheRate(tokens())).toBe("-")
  })
})

describe("fetchSessionMessages", () => {
  const page = (data: SessionMessageInfo[], next: string | null) => ({ data, cursor: { next } })

  test("follows the cursor and appends pages in order", async () => {
    const calls: Array<{ sessionID: string; limit?: number; cursor?: string }> = []
    const client = {
      message: {
        list: async (input: { sessionID: string; limit?: number; cursor?: string }) => {
          calls.push(input)
          return input.cursor ? page([user("m3")], null) : page([user("m1"), user("m2")], "next")
        },
      },
    }
    expect((await fetchSessionMessages(client, "s1")).map((message) => message.id)).toEqual(["m1", "m2", "m3"])
    expect(calls).toEqual([
      { sessionID: "s1", limit: 200, cursor: undefined },
      { sessionID: "s1", limit: 200, cursor: "next" },
    ])
  })

  test("stops after the page limit", async () => {
    let calls = 0
    const client = {
      message: {
        list: async () => {
          calls++
          return page([user(`m${calls}`)], "next")
        },
      },
    }
    const result = await fetchSessionMessages(client, "s1", undefined, 3)
    expect(result).toHaveLength(3)
    expect(calls).toBe(3)
  })

  test("stops when the signal is aborted before the first request", async () => {
    const calls: unknown[] = []
    const client = {
      message: {
        list: async (input: unknown) => {
          calls.push(input)
          return page([user("m1")], null)
        },
      },
    }
    const controller = new AbortController()
    controller.abort()
    expect(await fetchSessionMessages(client, "s1", controller.signal)).toEqual([])
    expect(calls).toEqual([])
  })

  test("stops after the page in flight when the signal aborts meanwhile", async () => {
    const controller = new AbortController()
    const client = {
      message: {
        list: async () => {
          controller.abort()
          return page([user("m1")], "next")
        },
      },
    }
    expect((await fetchSessionMessages(client, "s1", controller.signal)).map((message) => message.id)).toEqual(["m1"])
  })
})
