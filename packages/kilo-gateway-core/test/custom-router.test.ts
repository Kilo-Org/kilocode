import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { KiloCustomRouter } from "../src/index.js"
import { fixture } from "../src/testing.js"

// Port of the routing, contract, and client entry assertions of v1
// packages/opencode/test/kilocode/auto-custom-router.test.ts (#15183), against the local Kilo API fixture.
const LOCAL = new Set(["ollama/qwen3"])
const servable = (entry: { provider: string; model: string }) => LOCAL.has(`${entry.provider}/${entry.model}`)
const previous = process.env.KILO_AUTO_ROUTING_URL

afterEach(() => {
  if (previous === undefined) delete process.env.KILO_AUTO_ROUTING_URL
  else process.env.KILO_AUTO_ROUTING_URL = previous
})

function clientListing() {
  return {
    key: "client:ollama/qwen3",
    entry: {
      kind: "client",
      provider: "ollama",
      model: "qwen3",
      variants: ["low", "high"],
      capabilities: { contextLength: 128_000, inputModalities: ["text", "image"], toolCall: true, reasoning: true },
      pricing: null,
    } as Record<string, unknown>,
    needsClientEval: true,
    variants: [{ variant: null, status: "missing", failureReason: null }],
  }
}

function decision(entry: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    decision: {
      entry,
      model: entry.kind === "client" ? `client:${entry.provider}/${entry.model}` : entry.model,
      variant: null,
      stale: false,
      fallback: false,
      sticky: false,
      taskType: null,
      subtaskType: null,
      tableVersion: null,
      ...extra,
    },
    decisionId: "decision-1",
  }
}

function setup(token: string) {
  const backend = fixture()
  process.env.KILO_AUTO_ROUTING_URL = backend.url
  const run = (overrides: Partial<KiloCustomRouter.ResolveInput> = {}) =>
    Effect.runPromise(
      KiloCustomRouter.resolve({
        account: { server: backend.url, token, organizationID: null, version: "1.0.0" },
        modelID: "kilo-auto/custom/myrouter",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        sessionID: "ses_1",
        requestID: "msg_1",
        mode: "code",
        machineID: "machine-1",
        servable,
        ...overrides,
      }),
    )
  return { backend, run }
}

describe("model ids", () => {
  test("accepts user and org custom router ids only", () => {
    expect(KiloCustomRouter.parseModelID("kilo-auto/custom/myrouter")).toEqual({ scope: "user", slug: "myrouter" })
    expect(KiloCustomRouter.parseModelID("kilo-auto/custom/org/myrouter")).toEqual({ scope: "org", slug: "myrouter" })
    expect(KiloCustomRouter.parseModelID("kilo-auto/efficient")).toBeUndefined()
    expect(KiloCustomRouter.parseModelID("kilo-auto/custom/org")).toBeUndefined()
    expect(KiloCustomRouter.parseModelID("kilo-auto/custom/Bad_Slug")).toBeUndefined()
  })

  test("resolves a full id, a slug, or an org slug like the v1 commands", () => {
    expect(KiloCustomRouter.resolveReference("myrouter")?.modelID).toBe("kilo-auto/custom/myrouter")
    expect(KiloCustomRouter.resolveReference("org/team")?.modelID).toBe("kilo-auto/custom/org/team")
    expect(KiloCustomRouter.resolveReference("kilo-auto/custom/org/team")?.reference).toEqual({
      scope: "org",
      slug: "team",
    })
    expect(KiloCustomRouter.resolveReference("not a slug")).toBeUndefined()
  })
})

describe("contracts mirror", () => {
  test("rejects a gateway entry that uses the reserved client prefix", () => {
    expect(Schema.is(KiloCustomRouter.EntryRef)({ kind: "gateway", model: "client:ollama/qwen3" })).toBe(false)
    expect(Schema.is(KiloCustomRouter.EntryRef)({ kind: "gateway", model: "anthropic/claude-sonnet-4" })).toBe(true)
  })

  test("defaults a missing staleEntries list", () => {
    const plan = Schema.decodeUnknownSync(KiloCustomRouter.EvalPlan)({
      baseRouter: "efficient",
      engineIdentity: "engine",
      repetitions: 1,
      items: [],
    })
    expect(plan.staleEntries).toEqual([])
  })
})

describe("servable entries", () => {
  test("keeps only client entries this client can serve", () => {
    const backend = fixture()
    try {
      const router = {
        ...backend.state.customRouters.routers[0]!,
        entries: [clientListing(), ...backend.state.customRouters.routers[0]!.entries],
      }
      const decoded = Schema.decodeUnknownSync(KiloCustomRouter.Summary)(router)
      expect(KiloCustomRouter.servableEntries(decoded, servable).map((entry) => entry.model)).toEqual(["qwen3"])
      expect(KiloCustomRouter.servableEntries(decoded, () => false)).toEqual([])
    } finally {
      backend[Symbol.dispose]()
    }
  })
})

describe("routing decision", () => {
  test("sends the custom id to the gateway when no client entry is servable", async () => {
    const { backend, run } = setup("token-a")
    using _ = backend
    expect(await run()).toBeUndefined()
    expect(backend.state.customRouterBodies.map((item) => item.path)).toEqual(["/api/auto-routing/custom-routers"])
  })

  test("routes a client pick to the local provider and model", async () => {
    const { backend, run } = setup("token-b")
    using _ = backend
    backend.state.customRouters.routers[0]!.entries.push(clientListing())
    backend.state.decide = decision({ kind: "client", provider: "ollama", model: "qwen3" }, { variant: "high" })
    expect(await run()).toEqual({ kind: "client", provider: "ollama", model: "qwen3", variant: "high" })
    const decide = backend.state.customRouterBodies.find((item) => item.path === "/v1/decide")
    expect(decide?.body).toEqual({
      model: "kilo-auto/custom/myrouter",
      messages: [{ role: "user", content: "hi" }],
      sessionId: "ses_1",
      machineId: "machine-1",
      clientRequestId: "msg_1",
      mode: "code",
      clientEntries: [{ provider: "ollama", model: "qwen3" }],
    })
    expect(backend.requests.find((item) => item.path === "/v1/decide")?.authorization).toBe("Bearer token-b")
  })

  test("routes a gateway pick through the gateway with the decision token", async () => {
    const { backend, run } = setup("token-c")
    using _ = backend
    backend.state.customRouters.routers[0]!.entries.push(clientListing())
    backend.state.decide = {
      ...decision({ kind: "gateway", model: "anthropic/claude-sonnet-4" }, { stale: true, fallback: true }),
      decisionId: "decision-2",
    }
    expect(await run()).toEqual({
      kind: "gateway",
      model: "anthropic/claude-sonnet-4",
      variant: null,
      decisionId: "decision-2",
    })
  })

  test("refuses a client pick this client cannot serve", async () => {
    const { backend, run } = setup("token-d")
    using _ = backend
    backend.state.customRouters.routers[0]!.entries.push(clientListing())
    backend.state.decide = decision({ kind: "client", provider: "lmstudio", model: "qwen3" })
    await expect(run()).rejects.toThrow("No model in this custom auto router can serve this request")
  })

  test("fails when the router is missing instead of routing elsewhere", async () => {
    const { backend, run } = setup("token-e")
    using _ = backend
    backend.state.customRouters.routers[0]!.modelId = "kilo-auto/custom/other"
    await expect(run()).rejects.toThrow("was not found")
  })

  test("fails without a Kilo token and ignores other models", async () => {
    const { backend, run } = setup("")
    using _ = backend
    await expect(run()).rejects.toThrow("Sign in to Kilo")
    expect(await run({ modelID: "kilo-auto/frontier" })).toBeUndefined()
    expect(backend.state.customRouterBodies).toEqual([])
  })

  test("caches the router list for 30 seconds", async () => {
    const { backend, run } = setup("token-cache")
    using _ = backend
    await run({ now: () => 1_000 })
    await run({ now: () => 20_000 })
    expect(backend.state.customRouterBodies.length).toBe(1)
    await run({ now: () => 40_000 })
    expect(backend.state.customRouterBodies.length).toBe(2)
  })

  test("shares one router list request between concurrent decisions", async () => {
    const { backend, run } = setup("token-shared")
    using _ = backend
    await Promise.all([run({ now: () => 1_000 }), run({ now: () => 1_000 }), run({ now: () => 1_000 })])
    expect(backend.state.customRouterBodies.length).toBe(1)
  })

  test("surfaces worker error codes with specific messages", async () => {
    const codes = [
      ["insufficient_balance", "balance is too low"],
      ["quota_exceeded", "benchmark limit for this router owner is reached. Try again later"],
      ["unauthorized", "Sign in to Kilo"],
      ["forbidden", "do not have access"],
      ["router_not_found", "was not found"],
      ["invalid_request", "rejected the custom router request"],
      ["custom_router_unavailable", "can serve this request"],
      ["stale_engine_identity", "needs a fresh evaluation"],
      ["internal_error", "auto routing failed"],
    ] as const
    for (const [code, needle] of codes) expect(KiloCustomRouter.errorMessage(code)).toContain(needle)

    const balance = setup("token-f")
    using _balance = balance.backend
    balance.backend.state.customRouters.routers[0]!.entries.push(clientListing())
    balance.backend.state.decideStatus = 402
    balance.backend.state.decide = { error: { code: "insufficient_balance", message: "no credit" } }
    await expect(balance.run()).rejects.toThrow("Top up")

    const malformed = setup("token-g")
    using _malformed = malformed.backend
    malformed.backend.state.customRouters.routers[0]!.entries.push(clientListing())
    malformed.backend.state.decide = { unexpected: true }
    await expect(malformed.run()).rejects.toThrow("Unexpected response from the custom router service")
  })

  test("reports the quota reset time when the worker sends one", async () => {
    const limited = setup("token-h")
    using _limited = limited.backend
    limited.backend.state.customRouters.routers[0]!.entries.push(clientListing())
    limited.backend.state.decideStatus = 429
    limited.backend.state.decide = {
      error: { code: "quota_exceeded", message: "limit", retryAt: "2026-10-17T00:00:00.000Z" },
    }
    await expect(limited.run()).rejects.toThrow("Try again after 2026-10-17T00:00:00.000Z")

    const bare = setup("token-i")
    using _bare = bare.backend
    bare.backend.state.customRouters.routers[0]!.entries.push(clientListing())
    bare.backend.state.decideStatus = 429
    bare.backend.state.decide = "slow down"
    await expect(bare.run()).rejects.toThrow("benchmark limit for this router owner is reached. Try again later")
  })
})

describe("web routes", () => {
  let backend: ReturnType<typeof fixture>
  beforeEach(() => {
    backend = fixture()
    process.env.KILO_AUTO_ROUTING_URL = backend.url
  })
  afterEach(() => backend[Symbol.dispose]())

  test("registers and removes a client entry in the selected team scope", async () => {
    const account = {
      server: `${backend.url}/api/organizations/team`,
      token: "token",
      organizationID: "team",
      version: "1.0.0",
    }
    const entry = KiloCustomRouter.clientEntry({
      provider: "ollama",
      model: "qwen3",
      variants: [],
      context: 0,
      input: ["text"],
      toolCall: true,
      reasoning: false,
    })
    const added = await Effect.runPromise(
      KiloCustomRouter.register(account, { scope: "user", slug: "myrouter" }, entry),
    )
    expect(added.router.entries.map((item) => item.key)).toContain("client:ollama/qwen3")
    const removed = await Effect.runPromise(
      KiloCustomRouter.remove(account, { scope: "user", slug: "myrouter" }, { provider: "ollama", model: "qwen3" }),
    )
    expect(removed.router.entries.map((item) => item.key)).not.toContain("client:ollama/qwen3")
    expect(backend.state.customRouterBodies.map((item) => `${item.method} ${item.path}`)).toEqual([
      "POST /api/auto-routing/custom-routers/user/myrouter/client-entries",
      "DELETE /api/auto-routing/custom-routers/user/myrouter/client-entries?provider=ollama&model=qwen3",
    ])
    expect(backend.requests.at(-1)?.organizationID).toBe("team")
  })

  test("hides an error body that is not JSON", async () => {
    backend.state.customRoutersStatus = 503
    const error = await Effect.runPromise(
      Effect.flip(KiloCustomRouter.list({ server: backend.url, token: "token", version: "1.0.0" })),
    )
    expect(error).toMatchObject({ code: "internal_error", message: "request failed", status: 503 })
    expect(KiloCustomRouter.describe(error)).toBe("Kilo auto routing failed (request failed).")
  })

  test("rejects a case response without the exact prompt", async () => {
    backend.state.evalCase = {
      caseId: "case-1",
      baseRouter: "efficient",
      systemPrompt: "S",
      userPrompt: "U",
      timeoutMs: 1,
    }
    const account = { server: backend.url, token: "token", version: "1.0.0" }
    await expect(Effect.runPromise(KiloCustomRouter.evalCase(account, "router", "case-1"))).rejects.toThrow(
      "Unexpected response",
    )
  })
})

describe("client entry construction", () => {
  test("describes capabilities, pricing, and variants from the resolved model", () => {
    const model = {
      provider: "ollama",
      model: "qwen3",
      variants: ["low", "high"],
      context: 128_000,
      input: ["image", "text", "unknown"],
      toolCall: true,
      reasoning: true,
    }
    expect(
      KiloCustomRouter.clientEntry({ ...model, cost: { input: 3, output: 3, cacheRead: 0, cacheWrite: 0 } }),
    ).toEqual({
      kind: "client",
      provider: "ollama",
      model: "qwen3",
      variants: ["low", "high"],
      capabilities: { contextLength: 128_000, inputModalities: ["text", "image"], toolCall: true, reasoning: true },
      pricing: { inputPerMTokUsd: 3, outputPerMTokUsd: 3 },
    })
    expect(KiloCustomRouter.clientEntry({ ...model, variants: [], context: 0 })).toMatchObject({
      variants: [],
      pricing: null,
      capabilities: { contextLength: null },
    })
  })
})
