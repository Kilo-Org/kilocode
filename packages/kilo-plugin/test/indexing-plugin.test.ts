import { afterAll, afterEach, expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Stream } from "effect"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloGatewayAccounts } from "../src/gateway/accounts"
import { KiloIndexingPlugin } from "../src/indexing"
import { IndexingWorker } from "../src/indexing/indexing-worker-client"

const dirs: string[] = []
// A shell inside VS Code exports KILO_PLATFORM=vscode, which gates indexing on consent.
const platform = process.env.KILO_PLATFORM
delete process.env.KILO_PLATFORM
afterAll(() => {
  if (platform !== undefined) process.env.KILO_PLATFORM = platform
})
afterEach(async () => {
  IndexingWorker.override()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

type Editor = {
  added: string[]
  updated: Record<string, string>
}

// The plugin against a stand-in plugin context: one config document, a fake engine, and a tool editor that records
// what the tool transform adds and how it changes glob and grep.
async function run(indexing: KiloConfigPolicy.Info["indexing"]) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-indexing-plugin-")))
  dirs.push(directory)
  IndexingWorker.override(() => ({
    init: async () => ({ state: "Complete", message: "Index up-to-date.", processedFiles: 0, totalFiles: 0, percent: 100 }),
    search: async () => [],
    dispose: async () => {},
  }))
  const unregister = KiloGatewayAccounts.register(directory, () => undefined)
  const transforms: ((editor: unknown) => void)[] = []
  const editor = (): Editor & { apply: () => Editor } => {
    const state: Editor = { added: [], updated: {} }
    const api = {
      add: (tool: { name: string }) => state.added.push(tool.name),
      update: (id: string, fn: (tool: { description: string }) => void) => {
        const tool = { description: id }
        fn(tool)
        state.updated[id] = tool.description
      },
    }
    return { ...state, apply: () => (transforms.forEach((fn) => fn(api)), state) }
  }
  const config = {
    entries: () =>
      Effect.succeed([new Document({ type: "document", info: new KiloConfigPolicy.Info({ indexing }) })]),
    changes: () => Stream.empty,
  } as unknown as Config.Interface
  const ctx = {
    location: { directory },
    app: { version: "test" },
    rpc: { register: () => Effect.succeed({ events: { emit: () => Effect.void } }) },
    tool: {
      transform: (fn: (editor: unknown) => void) => Effect.sync(() => transforms.push(fn)),
      reload: () => Effect.void,
    },
    permission: { assert: () => Effect.void },
    event: { subscribe: () => Stream.never },
  }
  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* KiloIndexingPlugin.effect(ctx as never)
          return editor().apply()
        }),
      ).pipe(
        Effect.provideService(Config.Service, config),
        Effect.provide(Global.layerWith({ home: directory, state: path.join(directory, ".state"), config: directory })),
        Effect.provide(LayerNode.compile(FSUtil.node)),
      ),
    )
  } finally {
    unregister()
  }
}

test("offers semantic_search from the indexing config before the index is ready", async () => {
  const state = await run({ enabled: true, provider: "ollama" })
  expect(state.added).toEqual(["semantic_search"])
  expect(state.updated.glob).toContain("use the `semantic_search` tool first")
  expect(state.updated.grep).toContain("use the `semantic_search` tool first")
})

test("does not offer semantic_search while indexing is disabled", async () => {
  expect(await run({ provider: "ollama" })).toEqual({ added: [], updated: {} })
  expect(await run(undefined)).toEqual({ added: [], updated: {} })
})
