import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloDefaults, KiloModels } from "../src/index.js"
import { fixture } from "../src/testing.js"

describe("KiloModels", () => {
  test("fetches personal models with pricing, variants, dialect, prompt, autoRouting, and terminalBench", async () => {
    using backend = fixture()
    const result = await Effect.runPromise(KiloModels.get({ server: backend.url, token: "token" }))
    expect(result.anonymous).toBe(false)
    expect(result.models.map((model) => model.id)).toEqual([
      "kilo-auto/free",
      "kilo-auto/frontier",
      "kilo-auto/small",
    ])
    const frontier = result.models.find((model) => model.id === "kilo-auto/frontier")
    expect(frontier).toMatchObject({
      id: "kilo-auto/frontier",
      name: "Kilo Auto Frontier",
      description: "Frontier router model",
      family: "claude",
      aiSDKProvider: "openrouter",
      free: false,
      recommendedIndex: 0,
      hasUserByokAvailable: true,
      mayTrainOnYourPrompts: false,
      autoRouting: { models: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4"] },
      terminalBench: { overallScore: 0.72, avgAttemptCostUsd: 0.45 },
      reasoning: true,
      temperature: true,
      limit: { context: 200000, output: 32000 },
      cost: { input: 3, output: 15, cacheRead: 0.3 },
      reasoningOptions: [{ type: "effort", values: ["high"] }],
    })
    const small = result.models.find((model) => model.id === "kilo-auto/small")
    expect(small?.family).toBe("gpt-luna")
    expect(KiloModels.entries(result.models)).toContainEqual({
      id: "kilo-auto/frontier",
      name: "Kilo Auto Frontier",
      isFree: false,
      recommendedIndex: 0,
      hasUserByokAvailable: true,
      mayTrainOnYourPrompts: false,
      autoRouting: { models: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4"] },
      terminalBench: { overallScore: 0.72, avgAttemptCostUsd: 0.45 },
      description: "Frontier router model",
      reasoning: true,
      family: "claude",
      aiSDKProvider: "openrouter",
    })
  })

  test("filters the anonymous catalog to isFree === true only", async () => {
    using backend = fixture()
    const result = await Effect.runPromise(KiloModels.get({ server: backend.url }))
    expect(result.anonymous).toBe(true)
    expect(result.models.map((model) => model.id)).toEqual(["kilo-auto/free", "kilo-auto/small"])
    expect(result.models.every((model) => model.free)).toBe(true)
  })

  test("fetches the team catalog from /api/organizations/:id/models and sends the team header", async () => {
    using backend = fixture()
    const result = await Effect.runPromise(
      KiloModels.get({ server: backend.url, token: "token", organizationID: "selected" }),
    )
    expect(result.anonymous).toBe(false)
    expect(result.models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4.6", "kilo-auto/small"])
    expect(result.models[0]?.reasoningOptions).toEqual([
      { type: "effort", values: ["low", "medium", "high", "max"] },
    ])
    expect(backend.requests.at(-1)).toEqual({
      method: "GET",
      path: "/api/organizations/selected/models",
      authorization: "Bearer token",
      organizationID: "selected",
    })
  })

  test("falls back to the anonymous free catalog on a personal 401, but never on a team 401", async () => {
    using backend = fixture()
    let calls = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        calls++
        if (request.headers.get("authorization")) return new Response("Unauthorized", { status: 401 })
        return Response.json(backend.state.models)
      },
    })
    try {
      const personal = await Effect.runPromise(KiloModels.get({ server: server.url.origin, token: "expired" }))
      expect(calls).toBe(2)
      expect(personal.anonymous).toBe(true)
      expect(personal.models.map((model) => model.id)).toEqual(["kilo-auto/free", "kilo-auto/small"])

      backend.state.teamModelsStatus = 401
      expect(
        await Effect.runPromise(
          KiloModels.get({ server: backend.url, token: "expired", organizationID: "selected" }).pipe(Effect.flip),
        ),
      ).toEqual({ kind: "unauthorized", status: 401 })
    } finally {
      server.stop(true)
    }
  })

  test("drops models that explicitly omit tools or have malformed fields, keeps empty supported_parameters, and ignores negative pricing", () => {
    const models = KiloModels.catalogModels(
      {
        data: [
          {
            id: "test/malformed-context",
            name: "Malformed Context",
            context_length: 0,
          },
          {
            id: "test/no-tools",
            name: "No Tools",
            context_length: 128000,
            supported_parameters: ["temperature"],
          },
          {
            id: "typesafe/jev-router",
            name: "Jev Router",
            context_length: 128000,
            supported_parameters: [],
            pricing: { prompt: "-1", completion: "-1" },
            terminalBench: { overallScore: 0.5 },
            autoRouting: { models: "invalid" },
            opencode: { ai_sdk_provider: "unknown", prompt: "unknown" },
          },
        ],
      },
      false,
    )
    expect(models.map((model) => model.id)).toEqual(["typesafe/jev-router"])
    expect(models[0]?.cost).toBeUndefined()
    expect(models[0]?.terminalBench).toBeUndefined()
    expect(models[0]?.autoRouting).toBeUndefined()
    expect(models[0]?.aiSDKProvider).toBeUndefined()
    expect(models[0]?.limit).toEqual({ context: 128000, output: 25600 })
  })

  test("parses Retry-After and computes catalog recovery backoff", async () => {
    using backend = fixture()
    backend.state.teamModelsStatus = 503
    backend.state.modelsRetryAfter = "90"
    const failure = await Effect.runPromise(
      KiloModels.get({ server: backend.url, token: "token", organizationID: "selected" }).pipe(Effect.flip),
    )
    expect(failure).toEqual({ kind: "http", status: 503, retryAfter: 90 })
    expect(KiloModels.retryable(failure)).toBe(true)
    expect(KiloModels.retryDelayMs(0, failure.retryAfter)).toBe(90_000)
    expect(KiloModels.retryDelayMs(0)).toBe(30_000)
    expect(KiloModels.retryDelayMs(10)).toBe(300_000)
  })
})

describe("KiloDefaults", () => {
  test("reads personal, team, and anonymous defaults and strips optional kilo/ prefix", async () => {
    using backend = fixture()
    expect(await Effect.runPromise(KiloDefaults.get({ server: backend.url }))).toBe("kilo-auto/free")
    expect(await Effect.runPromise(KiloDefaults.get({ server: backend.url, token: "token" }))).toBe(
      "kilo-auto/frontier",
    )
    expect(
      await Effect.runPromise(
        KiloDefaults.get({ server: backend.url, token: "token", organizationID: "selected" }),
      ),
    ).toBe("anthropic/claude-sonnet-4.6")
    backend.state.defaultsStatus = 500
    expect(await Effect.runPromise(KiloDefaults.get({ server: backend.url }))).toBe("kilo-auto/free")
    expect(await Effect.runPromise(KiloDefaults.get({ server: backend.url, token: "token" }))).toBe(
      "kilo-auto/frontier",
    )
  })
})
