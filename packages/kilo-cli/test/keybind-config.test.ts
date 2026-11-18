import { NodeFileSystem } from "@effect/platform-node"
import { Config } from "@opencode/cli/config/index"
import { Global } from "@opencode/util/global"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloCliConfig } from "../src/cli-config"

const content = process.env.OPENCODE_CLI_CONFIG_CONTENT

beforeEach(() => {
  delete process.env.OPENCODE_CLI_CONFIG_CONTENT
})

afterEach(() => {
  if (content === undefined) delete process.env.OPENCODE_CLI_CONFIG_CONTENT
  else process.env.OPENCODE_CLI_CONFIG_CONTENT = content
})

function run<A, E>(directory: string, effect: Effect.Effect<A, E, Config.Service>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(KiloCliConfig.layer),
      Effect.provide(Global.layerWith({ config: directory, state: directory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

async function profile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-keybind-config-"))
  return {
    path: directory,
    file: path.join(directory, "cli.json"),
    [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }),
  }
}

test("a blank profile cycles agents with tab and shift+tab", async () => {
  await using directory = await profile()
  const result = await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
  expect(result.keybinds).toEqual({ "agent.cycle": "tab", "agent.cycle.reverse": "shift+tab" })
  expect(result.theme).toEqual({ name: "kilo" })
  expect(await Bun.file(directory.file).exists()).toBe(false)
})

test("an explicit binding replaces only its own default", async () => {
  await using directory = await profile()
  await Bun.write(directory.file, JSON.stringify({ keybinds: { "agent.cycle": "ctrl+y" } }))
  const result = await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
  expect(result.keybinds).toEqual({ "agent.cycle": "ctrl+y", "agent.cycle.reverse": "shift+tab" })
})

test("an explicitly disabled binding stays disabled", async () => {
  await using directory = await profile()
  await Bun.write(
    directory.file,
    JSON.stringify({ keybinds: { "agent.cycle": "none", "agent.cycle.reverse": "none" } }),
  )
  const result = await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
  expect(result.keybinds).toEqual({ "agent.cycle": "none", "agent.cycle.reverse": "none" })
})

test("updates do not persist the default bindings", async () => {
  await using directory = await profile()
  await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const updated = yield* config.update((draft) => {
        expect(draft.keybinds).toBeUndefined()
        draft.mouse = false
      })
      expect(updated).toMatchObject({
        keybinds: { "agent.cycle": "tab", "agent.cycle.reverse": "shift+tab" },
        mouse: false,
      })
    }),
  )
  expect(await Bun.file(directory.file).json()).toEqual({
    $schema: "https://opencode.ai/v2/cli.json",
    mouse: false,
  })
})
