import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Config } from "@/config/config"
import { KiloCompactionChunks } from "@/kilocode/session/compaction-chunks"
import type { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ProviderTest } from "../fake/provider"

// Regression for https://github.com/Kilo-Org/kilocode/issues/15165.
// A custom openai-compatible model without a `limit` block loads with
// `limit: { context: 0, output: 0 }` (src/provider/provider.ts). Then usable()
// returns 0, the chunk budget floors to 1_000 tokens, and chunked compaction
// sends one model call per message (the reported `chunks=673`).

const providerID = ProviderV2.ID.make("custom")
const modelID = ModelV2.ID.make("deepseek-v4-1-flash")
const sessionID = SessionID.make("ses_unknown_context")
const cfg = {} as Config.Info
const model = ProviderTest.model({
  providerID,
  id: modelID,
  api: { id: modelID, url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
  limit: { context: 0, output: 0 },
})

function messages(count: number): MessageV2.WithParts[] {
  return Array.from({ length: count }, (_, index) => {
    const id = MessageID.ascending()
    return {
      info: {
        id,
        role: "user" as const,
        sessionID,
        agent: "code",
        model: { providerID, modelID },
        time: { created: Date.now() + index },
      },
      parts: [
        {
          id: PartID.ascending(),
          messageID: id,
          sessionID,
          type: "text" as const,
          // ~1_500 estimated tokens: larger than the 1_000 floor, tiny for a 1M model
          text: `${index}: ${"lorem ipsum dolor ".repeat(330)}`,
        },
      ],
    }
  })
}

describe("compaction with unknown model context (#15165)", () => {
  test("does not split a small session into one chunk per message", async () => {
    const msgs = messages(20)
    const size = KiloCompactionChunks.budget({ cfg, model })
    const chunks = await Effect.runPromise(KiloCompactionChunks.split({ messages: msgs, model, size }))

    // 20 messages of ~1.5k tokens (~30k total) must not cost 20 summary calls.
    expect(chunks.length).toBe(1)
    expect(KiloCompactionChunks.needed({ cfg, model, tokens: 30_000 })).toBe(false)
  })
})
