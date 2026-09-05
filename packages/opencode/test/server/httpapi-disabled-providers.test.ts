// kilocode_change - new file
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiLayer))
const projectOptions = { config: { formatter: false, lsp: false } }

function providerIDs(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((item): item is { id: unknown } => typeof item === "object" && item !== null && "id" in item)
    .map((item) => String(item.id))
}

describe("disabled-providers HttpApi", () => {
  it.instance(
    "filters providers by disabled_providers in project config",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-kilo-directory": directory }

      const response = yield* request("/provider/disabled", { headers })

      expect(response.status).toBe(200)
      const body = yield* response.json
      const ids = providerIDs(body)
      expect(ids).toContain("anthropic")
      expect(ids).not.toContain("openai")
      expect(ids).not.toContain("google")
    }),
    { ...projectOptions, config: { formatter: false, lsp: false, disabled_providers: ["anthropic"] } },
  )

  it.instance(
    "returns an empty list when disabled_providers is unset",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-kilo-directory": directory }

      const response = yield* request("/provider/disabled", { headers })

      expect(response.status).toBe(200)
      const body = yield* response.json
      expect(Array.isArray(body)).toBe(true)
      expect(providerIDs(body)).toEqual([])
    }),
    projectOptions,
  )

  it.instance(
    "returns an empty list when disabled_providers is explicitly empty",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-kilo-directory": directory }

      const response = yield* request("/provider/disabled", { headers })

      expect(response.status).toBe(200)
      const body = yield* response.json
      expect(Array.isArray(body)).toBe(true)
      expect(providerIDs(body)).toEqual([])
    }),
    { ...projectOptions, config: { formatter: false, lsp: false, disabled_providers: [] } },
  )

  it.instance(
    "returns Provider.Info shaped entries with id and name",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-kilo-directory": directory }

      const response = yield* request("/provider/disabled", { headers })

      expect(response.status).toBe(200)
      const body = yield* response.json
      expect(Array.isArray(body)).toBe(true)
      for (const item of body as unknown[]) {
        expect(typeof item).toBe("object")
        expect(item).not.toBeNull()
        const record = item as Record<string, unknown>
        expect(typeof record.id).toBe("string")
        expect(typeof record.name).toBe("string")
        expect(typeof record.models).toBe("object")
        expect(record.models).not.toBeNull()
        expect(Array.isArray(record.models)).toBe(false)
      }
    }),
    { ...projectOptions, config: { formatter: false, lsp: false, disabled_providers: ["anthropic"] } },
  )
})
