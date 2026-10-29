import { describe, expect, test } from "bun:test"
import { isEmbeddingProfileEqual, resolveEmbeddingProfile } from "../../../src/indexing/embedding-profile"

describe("embedding profile prompts", () => {
  test("keeps existing indexes compatible when prompts are omitted", () => {
    const profile = { provider: "openai-compatible" as const, modelId: "embeddinggemma-2", dimension: 768 }

    expect(resolveEmbeddingProfile(profile.provider, profile.modelId, profile.dimension)).toEqual(profile)
    expect(isEmbeddingProfileEqual(profile, resolveEmbeddingProfile(profile.provider, profile.modelId, 768))).toBe(true)
  })

  test("requires a rebuild when a document prompt is added, changed, or removed", () => {
    const plain = resolveEmbeddingProfile("openai-compatible", "embeddinggemma-2", 768)
    const first = resolveEmbeddingProfile("openai-compatible", "embeddinggemma-2", 768, "document")
    const second = resolveEmbeddingProfile("openai-compatible", "embeddinggemma-2", 768, "Document")

    expect(isEmbeddingProfileEqual(plain, first)).toBe(false)
    expect(isEmbeddingProfileEqual(first, second)).toBe(false)
    expect(isEmbeddingProfileEqual(first, plain)).toBe(false)
  })

  test("distinguishes a disabled server default from an omitted prompt", () => {
    const plain = resolveEmbeddingProfile("openai-compatible", "embeddinggemma-2", 768)
    const empty = resolveEmbeddingProfile("openai-compatible", "embeddinggemma-2", 768, "")

    expect(empty?.documentPrompt).toBe("")
    expect(isEmbeddingProfileEqual(plain, empty)).toBe(false)
  })

  test("does not apply OpenAI-compatible prompts to other providers", () => {
    const plain = resolveEmbeddingProfile("openai", "text-embedding-3-small")
    const prompt = resolveEmbeddingProfile("openai", "text-embedding-3-small", undefined, "document")

    expect(prompt?.documentPrompt).toBeUndefined()
    expect(isEmbeddingProfileEqual(plain, prompt)).toBe(true)
  })
})
