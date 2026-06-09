import { describe, expect, test } from "bun:test"
import type { Model } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ModelID, ProviderID } from "@/provider/schema"
import { SessionID } from "@/session/schema"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"

function model(id: string, reasoning = true): Model {
  return {
    id: ModelID.make(id),
    providerID: ProviderID.make("kilo"),
    api: {
      id,
      url: "https://api.kilo.ai/api/openrouter",
      npm: "@kilocode/kilo-gateway",
    },
    name: id,
    capabilities: {
      temperature: true,
      reasoning,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1.5, output: 9, cache: { read: 0.15, write: 0.08333 } },
    limit: { context: 1_048_576, output: 65_536 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-05-19",
  }
}

describe("session title generation", () => {
  test("uses an isolated task ID", () => {
    expect(KiloSessionPrompt.titleID(SessionID.make("ses_test"))).toBe("title-ses_test")
  })

  test("uses the model default for reasoning-capable small models", () => {
    expect(ProviderTransform.smallOptions(model("google/gemini-3.5-flash"))).toEqual({
      reasoning: { enabled: true },
    })
    expect(ProviderTransform.smallOptions(model("anthropic/claude-haiku-4.5"))).toEqual({
      reasoning: { enabled: true },
    })
  })

  test("omits reasoning options for models without reasoning support", () => {
    expect(ProviderTransform.smallOptions(model("google/gemini-2.0-flash", false))).toEqual({})
  })
})
