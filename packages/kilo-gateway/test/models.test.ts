import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CatalogResponse, catalogEntries, catalogModels } from "../src/models"

describe("catalog models metadata", () => {
  test("decodes description, reasoning, and family from gateway payload", () => {
    const raw = {
      data: [
        {
          id: "kilo/model-full",
          name: "Full Model",
          description: "A comprehensive model description.",
          context_length: 128000,
          supported_parameters: ["tools", "reasoning"],
          opencode: { family: "claude" },
          terminalBench: { overallScore: 0.85, avgAttemptCostUsd: 0.12 },
          isFree: true,
        },
        {
          id: "kilo/model-minimal",
          name: "Minimal Model",
          description: null,
          context_length: 64000,
          supported_parameters: ["tools"],
          opencode: { family: null },
          isFree: false,
        },
      ],
    }

    const decoded = Schema.decodeUnknownSync(CatalogResponse)(raw)
    const models = catalogModels(decoded, false)
    expect(models).toHaveLength(2)

    const full = models.find((m) => m.id === "kilo/model-full")
    expect(full?.description).toBe("A comprehensive model description.")
    expect(full?.reasoning).toBe(true)
    expect(full?.family).toBe("claude")
    expect(full?.terminalBench).toEqual({ overallScore: 0.85, avgAttemptCostUsd: 0.12 })

    const minimal = models.find((m) => m.id === "kilo/model-minimal")
    expect(minimal?.description).toBeUndefined()
    expect(minimal?.reasoning).toBe(false)
    expect(minimal?.family).toBeUndefined()

    const entries = catalogEntries(models)
    const fullEntry = entries.find((e) => e.id === "kilo/model-full")
    expect(fullEntry?.description).toBe("A comprehensive model description.")
    expect(fullEntry?.reasoning).toBe(true)
    expect(fullEntry?.family).toBe("claude")
    expect(fullEntry?.terminalBench).toEqual({ overallScore: 0.85, avgAttemptCostUsd: 0.12 })

    const minEntry = entries.find((e) => e.id === "kilo/model-minimal")
    expect(minEntry?.description).toBeUndefined()
    expect(minEntry?.reasoning).toBeUndefined()
    expect(minEntry?.family).toBeUndefined()
  })

  test("handles absent optional fields gracefully", () => {
    const raw = {
      data: [
        {
          id: "kilo/model-absent",
          name: "Absent Model",
          context_length: 32000,
        },
      ],
    }

    const decoded = Schema.decodeUnknownSync(CatalogResponse)(raw)
    const models = catalogModels(decoded, false)
    expect(models).toHaveLength(1)

    const entry = catalogEntries(models)[0]
    expect(entry.description).toBeUndefined()
    expect(entry.reasoning).toBeUndefined()
    expect(entry.family).toBeUndefined()
    expect(entry.terminalBench).toBeUndefined()
  })
})
