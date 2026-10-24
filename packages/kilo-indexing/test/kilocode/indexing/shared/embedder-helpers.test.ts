import { describe, test, expect } from "bun:test"
import {
  applyQueryPrefix,
  batchTextsByTokenBudget,
  embedBatches,
  estimateTokenCount,
} from "../../../../src/indexing/shared/embedder-helpers"

describe("estimateTokenCount", () => {
  test("estimates tokens as roughly one per four characters", () => {
    expect(estimateTokenCount("")).toBe(0)
    expect(estimateTokenCount("abcd")).toBe(1)
    expect(estimateTokenCount("abcde")).toBe(2)
    expect(estimateTokenCount("x".repeat(8000))).toBe(2000)
  })
})

describe("applyQueryPrefix", () => {
  test("returns texts unchanged when there is no prefix", () => {
    expect(applyQueryPrefix(["a", "b"], undefined, 100)).toEqual(["a", "b"])
  })

  test("prepends the prefix to each text", () => {
    expect(applyQueryPrefix(["query"], "search: ", 100)).toEqual(["search: query"])
  })

  test("does not double-apply an existing prefix", () => {
    expect(applyQueryPrefix(["search: query"], "search: ", 100)).toEqual(["search: query"])
  })

  test("reports and skips items that would exceed the token limit after prefixing", () => {
    const oversized = "x".repeat(8000) // 2000 estimated tokens
    const seen: number[] = []
    const result = applyQueryPrefix([oversized], "prefix ", 100, (index) => seen.push(index))
    // The prefixed text is too large, so the original is returned unchanged.
    expect(result).toEqual([oversized])
    expect(seen).toEqual([0])
  })
})

describe("batchTextsByTokenBudget", () => {
  test("yields a single batch when everything fits", () => {
    const batches = [...batchTextsByTokenBudget(["a", "b", "c"], 100, 1000)]
    expect(batches).toEqual([["a", "b", "c"]])
  })

  test("splits by the batch token budget and fills later items into the next batch", () => {
    const a = "x".repeat(400) // 100 tokens
    const b = "x".repeat(400) // 100 tokens
    const batches = [...batchTextsByTokenBudget([a, b, "c"], 100, 150)]
    // a fills batch 1 (b would push it over 150, so it breaks). b and c then form batch 2.
    expect(batches).toEqual([[a], [b, "c"]])
  })

  test("skips items that exceed the per-item token limit", () => {
    const oversized = "x".repeat(8000) // 2000 tokens > 100
    const seen: number[] = []
    const batches = [...batchTextsByTokenBudget(["a", oversized, "b"], 100, 1000, (index) => seen.push(index))]
    expect(batches).toEqual([["a", "b"]])
    expect(seen).toEqual([1])
  })
})

describe("embedBatches", () => {
  const okEmbed = (texts: string[]) => ({
    embeddings: texts.map((text) => [text.length]),
    usage: { promptTokens: texts.length, totalTokens: texts.length },
  })

  test("embeds a single batch without splitting", async () => {
    const calls: string[][] = []
    const result = await embedBatches(["a", "bb"], 100, 1000, async (batch) => {
      calls.push(batch)
      return okEmbed(batch)
    })
    expect(calls).toEqual([["a", "bb"]])
    expect(result.embeddings).toEqual([[1], [2]])
  })

  test("splits a batch that the endpoint rejects for context overflow", async () => {
    const texts = ["1", "2", "3", "4"]
    const sizes: number[] = []
    const embed = async (batch: string[]) => {
      sizes.push(batch.length)
      if (batch.length > 2) {
        throw Object.assign(new Error("input (517 tokens) is larger than the max context size (512 tokens)"), {
          status: 400,
        })
      }
      return {
        embeddings: batch.map((text) => [text.charCodeAt(0)]),
        usage: { promptTokens: batch.length, totalTokens: batch.length },
      }
    }

    const result = await embedBatches(texts, 8191, 100000, embed)

    // One oversized call, then two halves.
    expect(sizes).toEqual([4, 2, 2])
    // Order is preserved across the split: "1","2" (left) then "3","4" (right).
    expect(result.embeddings).toEqual([
      [49],
      [50],
      [51],
      [52],
    ])
  })

  test("splits down to single items when needed", async () => {
    const texts = ["a", "b", "c", "d", "e", "f"]
    const embed = async (batch: string[]) => {
      if (batch.length > 1) {
        throw Object.assign(new Error("prompt is too long"), { status: 400 })
      }
      return okEmbed(batch)
    }

    const result = await embedBatches(texts, 8191, 100000, embed)

    expect(result.embeddings).toHaveLength(6)
  })

  test("rethrows a context-overflow error for a single item", async () => {
    const embed = async () => {
      throw Object.assign(new Error("input is too long for the embedding model"), { status: 400 })
    }
    await expect(embedBatches(["very long text"], 8191, 100000, embed)).rejects.toThrow("input is too long")
  })

  test("does not split on a non-overflow 4xx and propagates it", async () => {
    const embed = async () => {
      throw Object.assign(new Error("Model not found"), { status: 404 })
    }
    await expect(embedBatches(["a", "b"], 8191, 100000, embed)).rejects.toThrow("Model not found")
  })

  test("does not split on a transient 5xx and propagates it", async () => {
    const embed = async () => {
      throw Object.assign(new Error("Internal server error"), { status: 500 })
    }
    await expect(embedBatches(["a", "b"], 8191, 100000, embed)).rejects.toThrow("Internal server error")
  })

  test("sums usage across split batches", async () => {
    const texts = ["1", "2", "3", "4"]
    const embed = async (batch: string[]) => {
      if (batch.length > 2) {
        throw Object.assign(new Error("context size exceeded"), { status: 400 })
      }
      return {
        embeddings: batch.map(() => [0.1]),
        usage: { promptTokens: batch.length, totalTokens: batch.length * 2 },
      }
    }
    const result = await embedBatches(texts, 8191, 100000, embed)
    expect(result.usage).toEqual({ promptTokens: 4, totalTokens: 8 })
  })
})
