import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  KiloAutocomplete,
  KiloModels,
  KiloModes,
  KiloNotifications,
  KiloProfile,
  KiloTrpc,
} from "../src/index.js"
import { fixture } from "../src/testing.js"

describe("Enterprise account, tRPC, modes, notifications, media, and FIM/edit", () => {
  test("fetches balance, Kilo Pass, BYOK entries, and Coding Plans via tRPC", async () => {
    using backend = fixture()
    expect(await Effect.runPromise(KiloProfile.balance(backend.url, "token", "selected"))).toEqual({
      balance: 42.5,
      isDepleted: false,
    })
    expect(backend.requests.at(-1)).toEqual({
      method: "GET",
      path: "/api/profile/balance",
      authorization: "Bearer token",
      organizationID: "selected",
    })

    expect(await Effect.runPromise(KiloTrpc.kiloPass(backend.url, "token"))).toEqual({
      currentPeriodBaseCreditsUsd: 50,
      currentPeriodUsageUsd: 12.25,
      currentPeriodBonusCreditsUsd: 5,
      nextBillingAt: "2026-11-01T00:00:00Z",
    })
    expect(
      KiloTrpc.parseKiloPassState({
        subscription: { status: "canceled", currentPeriodBaseCreditsUsd: 50, currentPeriodUsageUsd: 10 },
      }),
    ).toBeNull()

    expect(await Effect.runPromise(KiloTrpc.byokEntries(backend.url, "token"))).toEqual([
      { id: "byok-1", provider_id: "anthropic", management_source: "user", is_enabled: true },
    ])
    expect(await Effect.runPromise(KiloTrpc.codingPlanSubscriptions(backend.url, "token"))).toEqual([
      {
        id: "sub-1",
        planId: "plan-pro",
        planName: "Kilo Coding Plan Pro",
        providerName: "Anthropic",
        providerId: "anthropic",
        canQueryUsage: true,
        hasInstalledByokKey: true,
        status: "active",
        cancelAtPeriodEnd: false,
      },
    ])
    expect(await Effect.runPromise(KiloTrpc.codingPlanUsage(backend.url, "token", "sub-1"))).toMatchObject({
      schemaVersion: 1,
      subscription: {
        id: "sub-1",
        windows: [{ id: "five_hour", remainingPercent: 75 }],
      },
    })
  })

  test("keeps only live Kilo Pass states and returns null when the state is unavailable", async () => {
    const pass = (subscription: Record<string, unknown>) => KiloTrpc.parseKiloPassState({ subscription })
    expect(pass({ status: "expired", currentPeriodBaseCreditsUsd: 50, currentPeriodUsageUsd: 1 })).toBeNull()
    expect(pass({ status: "active" })).toBeNull()
    expect(pass({ status: "past_due", currentPeriodBaseCreditsUsd: 50, currentPeriodUsageUsd: 10 })).toEqual({
      currentPeriodBaseCreditsUsd: 50,
      currentPeriodUsageUsd: 10,
      currentPeriodBonusCreditsUsd: 0,
      nextBillingAt: null,
    })
    using backend = fixture()
    backend.state.kiloPassStatus = 503
    expect(await Effect.runPromise(KiloTrpc.kiloPass(backend.url, "token"))).toBeNull()
  })

  test("rejects tRPC procedure errors, malformed answers, and usage that does not match the subscription", async () => {
    using backend = fixture()
    const failure = <A>(effect: Effect.Effect<A, KiloTrpc.CloudTrpcError>) => Effect.runPromise(Effect.flip(effect))

    backend.state.byok = { error: { message: "internal detail" } }
    const procedure = await failure(KiloTrpc.byokEntries(backend.url, "token"))
    expect(procedure.kind).toBe("procedure")
    expect(procedure.message).not.toContain("internal detail")

    backend.state.byok = "not an envelope"
    expect((await failure(KiloTrpc.byokEntries(backend.url, "token"))).kind).toBe("protocol")

    backend.state.codingPlans = { result: { data: { json: [{ id: "sub-1" }] } } }
    expect((await failure(KiloTrpc.codingPlanSubscriptions(backend.url, "token"))).kind).toBe("schema")

    expect((await failure(KiloTrpc.codingPlanUsage(backend.url, "token", "sub-2"))).kind).toBe("schema")
    const window = { id: "five_hour", remainingPercent: 75, resetsAt: "2026-10-14T17:00:00Z", period: { unit: "hour", value: 5 } }
    backend.state.codingPlanUsage = {
      result: {
        data: {
          json: {
            schemaVersion: 1,
            fetchedAt: "2026-10-14T12:00:00Z",
            subscription: { id: "sub-1", planName: "Pro", providerId: "a", providerName: "A", windows: [window, window] },
          },
        },
      },
    }
    expect((await failure(KiloTrpc.codingPlanUsage(backend.url, "token", "sub-1"))).kind).toBe("schema")
  })

  test("fetches organization modes, notifications, image models, and transcription models", async () => {
    using backend = fixture()
    KiloModes.clearCache()
    const modes = await Effect.runPromise(KiloModes.get(backend.url, "token", "selected"))
    expect(modes).toHaveLength(1)
    expect(modes[0]).toMatchObject({
      id: "mode-1",
      slug: "security-reviewer",
      name: "Security Reviewer",
    })

    const notifications = await Effect.runPromise(KiloNotifications.get(backend.url, "token", "selected"))
    expect(notifications).toEqual([
      {
        id: "notif-1",
        title: "Kilo v2 Available",
        message: "Try the new v2 CLI.",
        action: { actionText: "Learn more", actionURL: "https://kilo.ai" },
        showIn: ["cli"],
      },
    ])

    const images = await Effect.runPromise(KiloModels.imageModels({ server: backend.url, token: "token" }))
    expect(images).toEqual([
      {
        id: "google/gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image",
        description: "Image generation model",
      },
    ])

    const transcriptions = await Effect.runPromise(
      KiloModels.transcriptionModels({ server: backend.url, token: "token" }),
    )
    expect(transcriptions).toEqual([
      { id: "openai/gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe" },
    ])
  })

  test("does not reuse organization modes across credentials or cache endpoint failures", async () => {
    using backend = fixture()
    const original = backend.state.modes
    KiloModes.clearCache()
    expect(await Effect.runPromise(KiloModes.get(backend.url, "first-token", "selected"))).toHaveLength(1)
    backend.state.modes = { modes: [] }
    expect(await Effect.runPromise(KiloModes.get(backend.url, "second-token", "selected"))).toEqual([])
    expect(await Effect.runPromise(KiloModes.get(backend.url, "first-token", "selected"))).toHaveLength(1)
    KiloModes.clearCache()
    backend.state.modesStatus = 503
    expect(await Effect.runPromise(KiloModes.get(backend.url, "first-token", "selected"))).toEqual([])
    backend.state.modesStatus = 200
    backend.state.modes = original
    expect(await Effect.runPromise(KiloModes.get(backend.url, "first-token", "selected"))).toHaveLength(1)
  })

  test("resolves FIM and Next Edit targets and extracts fenced edit bodies", async () => {
    expect(KiloAutocomplete.resolveFimTarget("kilo", "mistralai/codestral-2508", "https://api.kilo.ai")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://api.kilo.ai/api/gateway/fim/completions",
    })
    expect(KiloAutocomplete.resolveFimTarget("mistral", "codestral-2508", "https://api.kilo.ai")).toEqual({
      provider: "mistral",
      model: "codestral-2508",
    })
    expect(KiloAutocomplete.resolveEditTarget("kilo", "inception/mercury-next-edit", "https://api.kilo.ai")).toEqual({
      provider: "kilo",
      model: "inception/mercury-edit-2",
      url: "https://api.kilo.ai/api/gateway/edit/completions",
    })
    expect(KiloAutocomplete.resolveEditTarget("kilo", "mistralai/codestral-2508", "https://api.kilo.ai")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "",
    })
    expect(KiloAutocomplete.resolveFimTarget("kilo", "mistralai/codestral-2508", "https://ai-gateway.kilo.ai/api/v1"))
      .toMatchObject({ url: "https://ai-gateway.kilo.ai/api/v1/fim/completions" })
    expect(
      KiloAutocomplete.extractFencedBody("```ts\n<|code_to_edit|>\nconst x = 1\n<|/code_to_edit|>\n```"),
    ).toBe("const x = 1")
  })
})
