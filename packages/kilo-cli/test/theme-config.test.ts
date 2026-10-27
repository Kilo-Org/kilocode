import { NodeFileSystem } from "@effect/platform-node"
import { Config } from "@opencode/cli/config/index"
import { Global } from "@opencode/util/global"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloTheme } from "../src/theme"

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
      Effect.provide(KiloTheme.layer),
      Effect.provide(Global.layerWith({ config: directory, state: directory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

async function profile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-theme-config-"))
  return {
    path: directory,
    file: path.join(directory, "cli.json"),
    [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }),
  }
}

test("a blank profile defaults to kilo without writing a theme preference", async () => {
  await using directory = await profile()
  await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      expect(config.path).toBe(directory.file)
      expect(yield* config.get()).toEqual({ theme: { name: "kilo" } })
      expect(yield* config.get()).toEqual({ theme: { name: "kilo" } })
    }),
  )
  expect(await Bun.file(directory.file).exists()).toBe(false)
})

test.each(["light", "dark", "system"] as const)(
  "a mode-only file keeps mode %s and receives the in-memory kilo default",
  async (mode) => {
    await using directory = await profile()
    const text = JSON.stringify({ theme: { mode }, animations: false }, null, 2) + "\n"
    await Bun.write(directory.file, text)
    const result = await run(
      directory.path,
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    )
    expect(result).toEqual({ theme: { name: "kilo", mode }, animations: false })
    expect(await Bun.file(directory.file).text()).toBe(text)
  },
)

test.each(["opencode", "system", "custom-theme", "missing-theme"])(
  "keeps the explicit theme name %s without changing its file",
  async (name) => {
    await using directory = await profile()
    const text = JSON.stringify({ theme: { name, mode: "light" } })
    await Bun.write(directory.file, text)
    const result = await run(
      directory.path,
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    )
    expect(result.theme).toEqual({ name, mode: "light" })
    expect(await Bun.file(directory.file).text()).toBe(text)
  },
)

test("inline theme preferences override the file on get and update without being persisted", async () => {
  await using directory = await profile()
  await Bun.write(directory.file, JSON.stringify({ theme: { name: "opencode", mode: "dark" } }))
  process.env.OPENCODE_CLI_CONFIG_CONTENT = JSON.stringify({ theme: { name: "custom-theme", mode: "light" } })
  await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      expect((yield* config.get()).theme).toEqual({ name: "custom-theme", mode: "light" })
      const updated = yield* config.update((draft) => {
        draft.mouse = false
      })
      expect(updated).toMatchObject({ theme: { name: "custom-theme", mode: "light" }, mouse: false })
    }),
  )
  expect(await Bun.file(directory.file).json()).toEqual({
    theme: { name: "opencode", mode: "dark" },
    mouse: false,
  })
})

test("a mode-only inline overlay keeps an explicit file name", async () => {
  await using directory = await profile()
  const text = JSON.stringify({ theme: { name: "opencode", mode: "dark" } })
  await Bun.write(directory.file, text)
  process.env.OPENCODE_CLI_CONFIG_CONTENT = JSON.stringify({ theme: { mode: "light" } })
  const result = await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
  expect(result.theme).toEqual({ name: "opencode", mode: "light" })
  expect(await Bun.file(directory.file).text()).toBe(text)
})

test("an updated theme selection survives a new layer and reload", async () => {
  await using directory = await profile()
  await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      expect((yield* config.get()).theme?.name).toBe("kilo")
      const updated = yield* config.update((draft) => {
        expect(draft.theme).toBeUndefined()
        draft.theme = { name: "opencode", mode: "light" }
      })
      expect(updated.theme).toEqual({ name: "opencode", mode: "light" })
      expect((yield* config.get()).theme).toEqual(updated.theme)
    }),
  )
  expect(await Bun.file(directory.file).json()).toMatchObject({ theme: { name: "opencode", mode: "light" } })
  const reloaded = await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
  expect(reloaded.theme).toEqual({ name: "opencode", mode: "light" })
})

test("clearing a theme name restores the default without persisting it", async () => {
  await using directory = await profile()
  await Bun.write(directory.file, JSON.stringify({ theme: { name: "custom-theme", mode: "dark" }, mouse: false }))
  await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const updated = yield* config.update((draft) => {
        delete draft.theme?.name
      })
      expect(updated.theme).toEqual({ name: "kilo", mode: "dark" })
      expect((yield* config.get()).theme).toEqual(updated.theme)
    }),
  )
  const text = await Bun.file(directory.file).text()
  expect(await Bun.file(directory.file).json()).toEqual({ theme: { mode: "dark" }, mouse: false })
  const reloaded = await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
  expect(reloaded.theme).toEqual({ name: "kilo", mode: "dark" })
  expect(await Bun.file(directory.file).text()).toBe(text)
})

test("unrelated updates do not receive or persist the default name", async () => {
  await using directory = await profile()
  await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      yield* config.get()
      const updated = yield* config.update((draft) => {
        expect(draft.theme).toBeUndefined()
        draft.animations = false
      })
      expect(updated).toMatchObject({ theme: { name: "kilo" }, animations: false })
    }),
  )
  expect(await Bun.file(directory.file).json()).toEqual({
    $schema: "https://opencode.ai/v2/cli.json",
    animations: false,
  })
})

test("mode-only updates do not receive or persist the default name", async () => {
  await using directory = await profile()
  await Bun.write(directory.file, JSON.stringify({ theme: { mode: "dark" }, mouse: false }))
  await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      yield* config.get()
      const updated = yield* config.update((draft) => {
        expect(draft.theme).toEqual({ mode: "dark" })
        draft.theme = { ...draft.theme, mode: "light" }
      })
      expect(updated.theme).toEqual({ name: "kilo", mode: "light" })
      expect((yield* config.get()).theme).toEqual(updated.theme)
    }),
  )
  expect(await Bun.file(directory.file).json()).toEqual({ theme: { mode: "light" }, mouse: false })
})

test("a no-op update returns the default without creating a preference file", async () => {
  await using directory = await profile()
  const result = await run(
    directory.path,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.update((draft) => {
        expect(draft.theme).toBeUndefined()
      })
    }),
  )
  expect(result.theme).toEqual({ name: "kilo" })
  expect(await Bun.file(directory.file).exists()).toBe(false)
})
