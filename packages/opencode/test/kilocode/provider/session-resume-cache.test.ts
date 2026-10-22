import { describe, expect, test } from "bun:test"
import path from "node:path"
import { SessionResume } from "../../../src/kilocode/session-resume"
import { ProviderTransform } from "../../../src/provider/transform"
import { MessageV2 } from "../../../src/session/message-v2"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Provider } from "../../../src/provider/provider"
import type { Part as V1Part, WithParts } from "@opencode-ai/core/v1/session"

function cacheType(message: { providerOptions?: unknown }) {
  const anthropic = message.providerOptions as { anthropic?: { cacheControl?: { type?: unknown } } } | undefined
  return anthropic?.anthropic?.cacheControl?.type
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const claudeFixture = () =>
  Bun.file(path.join(__dirname, "../fixture/session-resume/claude.jsonl")).text()

const codexFixture = () =>
  Bun.file(path.join(__dirname, "../fixture/session-resume/codex.jsonl")).text()

// ── Model helpers ────────────────────────────────────────────────────────

function openaiModel(id: string, opts: { reasoning?: boolean } = {}): Provider.Model {
  return {
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.make("openai"),
    api: { id, url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
    name: "OpenAI Test",
    capabilities: {
      temperature: true,
      reasoning: opts.reasoning ?? false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: { context: 128000, output: 32000 },
    status: "active" as const,
    options: {},
    headers: {},
    release_date: "2025-01-01",
  }
}

function anthropicModel(id: string): Provider.Model {
  return {
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.make("anthropic"),
    api: { id, url: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic" },
    name: "Anthropic Test",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: { context: 200000, output: 32000 },
    status: "active" as const,
    options: {},
    headers: {},
    release_date: "2025-01-01",
  }
}

// ── Transcript helpers ───────────────────────────────────────────────────

const base = {
  sessionID: "ses_cache",
  agent: "build",
  providerID: "openai",
  modelID: "gpt-5",
  directory: "/test",
  worktree: "/test",
}

function castToWithParts(mapped: SessionResume.MappedMessage[]): WithParts[] {
  return mapped.map((m) => ({
    info: m.info as WithParts["info"],
    parts: m.parts as V1Part[],
  }))
}

// ── Helper: parse fixture through the full resume pipeline ────────────────

/** Parse a fixture JSONL, map through SessionResume, convert to model messages. */
async function buildModelMessages(model: Provider.Model, fixtureName: "claude" | "codex") {
  const content = fixtureName === "claude" ? await claudeFixture() : await codexFixture()
  const transcript = SessionResume.parseLines(content)
  const { messages } = SessionResume.mapTranscript(transcript, {
    ...base,
    ...(transcript.sourceModel ? { sourceModel: transcript.sourceModel } : {}),
  })
  const msgs = castToWithParts(messages)
  return MessageV2.toModelMessages(msgs, model)
}

// ── Cache-proof tests ─────────────────────────────────────────────────────

describe("MessageV2.toModelMessages + ProviderTransform cache continuity", () => {
  for (const fixture of ["claude", "codex"] as const) {
    test(`keeps the ${fixture} imported prefix and session cache key across two OpenAI requests`, async () => {
      const model = openaiModel("gpt-5")
      const imported = await buildModelMessages(model, fixture)
      const firstOptions = ProviderTransform.options({ model, sessionID: base.sessionID })
      const laterOptions = ProviderTransform.options({ model, sessionID: base.sessionID })
      const firstInput = [...structuredClone(imported), { role: "user" as const, content: "Continue from import." }]
      const laterInput = [
        ...structuredClone(imported),
        { role: "user" as const, content: "Continue from import." },
        { role: "assistant" as const, content: "The imported history is available." },
        { role: "user" as const, content: "Use a different model for this next turn." },
      ]
      const first = ProviderTransform.message(firstInput, model, firstOptions)
      const later = ProviderTransform.message(laterInput, model, laterOptions)

      expect(firstOptions.promptCacheKey).toBe(base.sessionID)
      expect(laterOptions.promptCacheKey).toBe(base.sessionID)
      expect(JSON.stringify(first.slice(0, imported.length))).toBe(JSON.stringify(later.slice(0, imported.length)))
    })
  }

  test("sets store:false for OpenAI models", () => {
    const model = openaiModel("gpt-5")
    const opts = ProviderTransform.options({ model, sessionID: "ses_test" })
    expect(opts.store).toBe(false)
  })


  test("fixture-derived messages preserve transcript text exactly (claude fixture)", async () => {
    const model = openaiModel("gpt-5")
    const modelMsgs = await buildModelMessages(model, "claude")
    const opts = ProviderTransform.options({ model, sessionID: base.sessionID })
    const transformed = ProviderTransform.message(modelMsgs, model, opts)

    expect(transformed.length).toBeGreaterThan(0)
    const raw = JSON.stringify(transformed)
    // First user message from the claude fixture
    expect(raw).toContain("Hello, can you help me read a file")
    // A later user message from the fixture
    expect(raw).toContain("What is the capital of France")
  })

  test("fixture-derived messages preserve transcript text exactly (codex fixture)", async () => {
    const model = openaiModel("gpt-5")
    const modelMsgs = await buildModelMessages(model, "codex")
    const opts = ProviderTransform.options({ model, sessionID: base.sessionID })
    const transformed = ProviderTransform.message(modelMsgs, model, opts)

    expect(transformed.length).toBeGreaterThan(0)
    const raw = JSON.stringify(transformed)
    // First user message from the codex fixture
    expect(raw).toContain("Read src/index.ts and then edit it")
    expect(raw).toContain("What is the capital of France")
  })
})

describe("ProviderTransform.message – Anthropic caching", () => {
  const SYSTEM = { role: "system" as const, content: "You are a test assistant." }

  test("marks the prepended system message with cache control (claude fixture)", async () => {
    const model = anthropicModel("claude-sonnet-4-20250514")
    const modelMsgs = await buildModelMessages(model, "claude")
    const opts = ProviderTransform.options({ model, sessionID: base.sessionID })

    const withSystem = [SYSTEM, ...modelMsgs]
    const transformed = ProviderTransform.message(withSystem, model, opts)

    const sys = transformed.find((m) => m.role === "system")
    expect(sys).toBeDefined()
    expect(cacheType(sys!)).toBe("ephemeral")
  })

  test("marks exactly the final two non-system messages with cache control (claude fixture)", async () => {
    const model = anthropicModel("claude-sonnet-4-20250514")
    const modelMsgs = await buildModelMessages(model, "claude")
    const opts = ProviderTransform.options({ model, sessionID: base.sessionID })

    const withSystem = [SYSTEM, ...modelMsgs]
    const transformed = ProviderTransform.message(withSystem, model, opts)

    const nonSystem = transformed.filter((m) => m.role !== "system")
    expect(nonSystem.length).toBeGreaterThanOrEqual(2)

    const last = nonSystem[nonSystem.length - 1]
    const prev = nonSystem[nonSystem.length - 2]
    expect(cacheType(last)).toBe("ephemeral")
    expect(cacheType(prev)).toBe("ephemeral")

    // No other non-system message carries cache control
    for (let i = 0; i < nonSystem.length - 2; i++) {
      expect(cacheType(nonSystem[i])).toBeUndefined()
    }
  })

  test("marks the prepended system message with cache control (codex fixture)", async () => {
    const model = anthropicModel("claude-sonnet-4-20250514")
    const modelMsgs = await buildModelMessages(model, "codex")
    const opts = ProviderTransform.options({ model, sessionID: base.sessionID })

    const withSystem = [SYSTEM, ...modelMsgs]
    const transformed = ProviderTransform.message(withSystem, model, opts)

    const sys = transformed.find((m) => m.role === "system")
    expect(sys).toBeDefined()
    expect(cacheType(sys!)).toBe("ephemeral")
  })

  test("marks exactly the final two non-system messages with cache control (codex fixture)", async () => {
    const model = anthropicModel("claude-sonnet-4-20250514")
    const modelMsgs = await buildModelMessages(model, "codex")
    const opts = ProviderTransform.options({ model, sessionID: base.sessionID })

    const withSystem = [SYSTEM, ...modelMsgs]
    const transformed = ProviderTransform.message(withSystem, model, opts)

    const nonSystem = transformed.filter((m) => m.role !== "system")
    expect(nonSystem.length).toBeGreaterThanOrEqual(2)

    const last = nonSystem[nonSystem.length - 1]
    const prev = nonSystem[nonSystem.length - 2]
    expect(cacheType(last)).toBe("ephemeral")
    expect(cacheType(prev)).toBe("ephemeral")

    for (let i = 0; i < nonSystem.length - 2; i++) {
      expect(cacheType(nonSystem[i])).toBeUndefined()
    }
  })
})
