import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import path from "path"
import { KilocodeGlobalConfigStamp } from "../../src/kilocode/config/global-stamp"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, CrossSpawnSpawner.node])))

describe("KilocodeGlobalConfigStamp", () => {
  it.live("returns a stable stamp while config files are unchanged", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      yield* fs.writeWithDirs(path.join(dir, "kilo.json"), JSON.stringify({ model: "test/model" }))

      const first = yield* KilocodeGlobalConfigStamp.read(dir)
      const second = yield* KilocodeGlobalConfigStamp.read(dir)
      expect(second).toBe(first)
      expect(second).toContain("kilo.json")
    }),
  )

  it.live("changes the stamp when a config file changes", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const file = path.join(dir, "kilo.json")
      yield* fs.writeWithDirs(file, JSON.stringify({ model: "test/model" }))
      const first = yield* KilocodeGlobalConfigStamp.read(dir)

      yield* fs.writeWithDirs(file, JSON.stringify({ model: "test/other-model" }))
      const second = yield* KilocodeGlobalConfigStamp.read(dir)
      expect(second).not.toBe(first)
    }),
  )

  it.live("detects a same-length rewrite", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const file = path.join(dir, "kilo.json")
      yield* fs.writeWithDirs(file, JSON.stringify({ model: "a/b" }))
      const first = yield* KilocodeGlobalConfigStamp.read(dir)

      yield* fs.writeWithDirs(file, JSON.stringify({ model: "c/d" }))
      const second = yield* KilocodeGlobalConfigStamp.read(dir)
      expect(second).not.toBe(first)
    }),
  )
})
