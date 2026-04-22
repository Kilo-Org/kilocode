// kilocode_change - new file
//
// Tests that the kilo custom loader gates paid models behind authentication.
// Mocks fetchKiloModels from @kilocode/kilo-gateway to avoid real network
// calls (which fail on Windows CI).

import { test, expect, mock } from "bun:test"
import path from "path"
import { unlink } from "fs/promises"

// Bun's mock.module() is process-wide and permanent — it replaces the module
// for ALL test files in the same runner process. To avoid breaking other tests
// that import @kilocode/kilo-gateway, we spread the real exports and only
// override fetchKiloModels with a stub that returns both free and paid models.
const real = await import("@kilocode/kilo-gateway")

mock.module("@kilocode/kilo-gateway", () => ({
  ...real,
  fetchKiloModels: async () => ({
    "free-model": {
      id: "free-model",
      name: "Free Model",
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 4096 },
    },
    "paid-model": {
      id: "paid-model",
      name: "Paid Model",
      cost: { input: 1.0, output: 2.0 },
      limit: { context: 128000, output: 4096 },
    },
  }),
}))

import { tmpdir } from "../fixture/fixture"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { ProviderID } from "../../src/provider/schema"
import { Filesystem } from "../../src/util"
import { ModelCache } from "../../src/provider/model-cache"
import { ModelsDev } from "../../src/provider"
import { Auth } from "../../src/auth"

function paid(providers: Awaited<ReturnType<typeof Provider.list>>) {
  const item = providers[ProviderID.kilo]
  expect(item).toBeDefined()
  return Object.values(item.models).filter((model) => model.cost.input > 0).length
}

test("kilo loader keeps paid models when config apiKey is present", async () => {
  // Reset state that may be stale from other test files sharing this process.
  // Auth.set from other tests persists in the shared auth.json, ModelsDev.Data
  // holds a lazy singleton whose resolved object gets mutated in-place by get(),
  // and ModelCache keeps fetched models in a TTL map.
  await Auth.remove("kilo")
  ModelCache.clear("kilo")
  ModelsDev.Data.reset()

  await using base = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "kilo.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
        }),
      )
    },
  })

  const none = await Instance.provide({
    directory: base.path,
    fn: async () => paid(await Provider.list()),
  })

  await using keyed = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "kilo.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
          provider: {
            kilo: {
              options: {
                apiKey: "test-key",
              },
            },
          },
        }),
      )
    },
  })

  const count = await Instance.provide({
    directory: keyed.path,
    fn: async () => paid(await Provider.list()),
  })

  expect(none).toBe(0)
  expect(count).toBeGreaterThan(0)
})

test("kilo loader keeps paid models when auth exists", async () => {
  await Auth.remove("kilo")
  ModelCache.clear("kilo")
  ModelsDev.Data.reset()

  await using base = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "kilo.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
        }),
      )
    },
  })

  const none = await Instance.provide({
    directory: base.path,
    fn: async () => paid(await Provider.list()),
  })

  await using keyed = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "kilo.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
        }),
      )
    },
  })

  const authPath = path.join(Global.Path.data, "auth.json")
  let prev: string | undefined

  try {
    prev = await Filesystem.readText(authPath)
  } catch {}

  try {
    await Filesystem.write(
      authPath,
      JSON.stringify({
        kilo: {
          type: "api",
          key: "test-key",
        },
      }),
    )

    const count = await Instance.provide({
      directory: keyed.path,
      fn: async () => paid(await Provider.list()),
    })

    expect(none).toBe(0)
    expect(count).toBeGreaterThan(0)
  } finally {
    if (prev !== undefined) {
      await Filesystem.write(authPath, prev)
    }
    if (prev === undefined) {
      try {
        await unlink(authPath)
      } catch {}
    }
  }
})
