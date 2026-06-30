import { describe, expect, spyOn, test } from "bun:test"
import { Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { KiloToolRegistry } from "../../src/kilocode/tool/registry"
import { Agent } from "../../src/agent/agent"
import * as Truncate from "../../src/tool/truncate"
import type * as Tool from "../../src/tool/tool"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const logger = Log.create({ service: "kilocode-tool-registry" })
const deps = { agent: {} as Agent.Interface, truncate: {} as Truncate.Interface }

describe("kilocode tool registry semantic tool import failure", () => {
  test("omits semantic_search when the semantic search tool cannot load", async () => {
    const err = new Error("semantic tool import failed")
    const warn = spyOn(logger, "warn").mockImplementation(() => {})

    await using tmp = await tmpdir({ git: true })

    try {
      const result = await provideTestInstance({
        directory: tmp.path,
        fn: () =>
          Effect.runPromise(
            KiloToolRegistry.build(infos(), deps, {
              indexing: async () => ({
                KiloIndexing: {
                  ready: () => true,
                },
              }),
              semantic: async () => {
                throw err
              },
            }),
          ),
      })

      expect(result.semantic).toBeUndefined()
      expect(result.recall.id).toBe("recall")
      expect(warn.mock.calls[0]?.[0]).toBe("semantic search tool unavailable")
      expect(warn.mock.calls[0]?.[1]?.err).toBeDefined()
    } finally {
      warn.mockRestore()
    }
  })
})

function infos() {
  return {
    codebase: info("codebase_search"),
    recall: info("recall"),
    managerModels: info("agent_manager_models"),
    manager: info("agent_manager"),
    process: info("background_process"),
    notebookRead: info("notebook_read"),
    notebookEdit: info("notebook_edit"),
    notebookExecute: info("notebook_execute"),
  }
}

function info(id: string): Tool.Info {
  return {
    id,
    init: () =>
      Effect.succeed({
        description: id,
        parameters: Schema.String,
        execute: () => Effect.succeed({ title: id, output: id, metadata: {} }),
      }),
  }
}
