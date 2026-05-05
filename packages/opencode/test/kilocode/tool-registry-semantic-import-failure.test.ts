import { afterEach, describe, expect, mock, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const err = new Error("semantic tool import failed")

mock.module("@/kilocode/indexing", () => ({
  KiloIndexing: {
    ready: () => true,
  },
}))

mock.module("@/kilocode/tool/semantic-search", () => {
  throw err
})

const { ToolRegistry } = await import("../../src/tool/registry")

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("kilocode tool registry semantic tool import failure", () => {
  it.live("keeps non-indexing tools when the semantic search tool cannot load", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const logger = Log.create({ service: "kilocode-tool-registry" })
          const warn = spyOn(logger, "warn").mockImplementation(() => {})

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).not.toContain("semantic_search")
            expect(ids).toContain("question")
            expect(ids).toContain("read")
            expect(ids).toContain("suggest")
            expect(warn.mock.calls[0]?.[0]).toBe("semantic search tool unavailable")
            expect(warn.mock.calls[0]?.[1]?.err).toBeDefined()
          } finally {
            warn.mockRestore()
          }
        }),
      { git: true },
    ),
  )
})
