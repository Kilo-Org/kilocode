import { describe, expect, test } from "bun:test"
import { parseModelsSnapshot } from "../../../src/kilocode/provider/models-snapshot-shape"

const fixture = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    npm: "@ai-sdk/anthropic",
    models: {
      "claude-test": {
        id: "claude-test",
        name: "Claude Test",
        release_date: "2026-01-01",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: {
          context: 200_000,
          output: 8_192,
        },
      },
    },
  },
}

describe("models snapshot validation", () => {
  test("accepts a valid snapshot and reports its size", () => {
    const parsed = parseModelsSnapshot(JSON.stringify(fixture))

    expect(parsed.data).toEqual(fixture)
    expect(parsed.stats).toEqual({ providers: 1, models: 1 })
    expect(JSON.stringify(parsed.data)).toBe(JSON.stringify(fixture))
  })

  test("fails invalid JSON", () => {
    expect(() => parseModelsSnapshot("{")).toThrow("not valid JSON")
  })

  test("fails empty snapshots", () => {
    expect(() => parseModelsSnapshot("{}")).toThrow("at least one provider")
  })

  test("fails malformed provider data", () => {
    const value = {
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        env: ["ANTHROPIC_API_KEY"],
        models: {
          broken: {
            id: "broken",
            name: "Broken",
            limit: {
              context: 100,
            },
          },
        },
      },
    }

    expect(() => parseModelsSnapshot(JSON.stringify(value))).toThrow("limit.output")
  })
})
