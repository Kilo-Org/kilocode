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

  test("resolves FIM and Next Edit targets and extracts fenced edit bodies", async () => {
    expect(KiloAutocomplete.resolveFimTarget("kilo", "mistralai/codestral-2508", "https://api.kilo.ai")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://ai-gateway.kilo.ai/api/v1/fim/completions",
    })
    expect(KiloAutocomplete.resolveFimTarget("mistral", "codestral-2508", "https://api.kilo.ai")).toEqual({
      provider: "mistral",
      model: "codestral-2508",
    })
    expect(KiloAutocomplete.resolveEditTarget("kilo", "inception/mercury-next-edit", "https://api.kilo.ai")).toEqual({
      provider: "kilo",
      model: "inception/mercury-edit-2",
      url: "https://ai-gateway.kilo.ai/api/v1/edit/completions",
    })
    expect(
      KiloAutocomplete.extractFencedBody("```ts\n<|code_to_edit|>\nconst x = 1\n<|/code_to_edit|>\n```"),
    ).toBe("const x = 1")
  })
})
