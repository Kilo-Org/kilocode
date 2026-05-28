import { afterEach, describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus } from "../../src/bus/global"
import { Server } from "../../src/server/server"
import { registerDisposer } from "../../src/effect/instance-registry"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const experimental = Flag.KILO_EXPERIMENTAL_HTTPAPI
const root = Global.Path.config

function app(value: boolean) {
  Flag.KILO_EXPERIMENTAL_HTTPAPI = value
  return value ? Server.Default().app : Server.Legacy().app
}

async function update(target: ReturnType<typeof app>, provider: "kilo" | "openrouter") {
  return target.request("/global/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ indexing: { provider } }),
  })
}

async function provider(target: ReturnType<typeof app>, directory: string) {
  const response = await target.request("/config", { headers: { "x-kilo-directory": directory } })
  return (await response.json()).indexing?.provider as string | undefined
}

afterEach(async () => {
  Flag.KILO_EXPERIMENTAL_HTTPAPI = experimental
  ;(Global.Path as { config: string }).config = root
  await disposeAllInstances()
  await resetDatabase()
})

describe("global config refresh", () => {
  for (const value of [false, true]) {
    test(`${value ? "httpapi" : "legacy"} update reloads existing instance before responding`, async () => {
      await using config = await tmpdir()
      await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = config.path
      await disposeAllInstances()
      const target = app(value)

      expect((await update(target, "openrouter")).status).toBe(200)
      expect(await provider(target, workspace.path)).toBe("openrouter")

      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const unregister = registerDisposer(async (directory) => {
        if (directory !== workspace.path) return
        started.resolve()
        await release.promise
      })
      try {
        const pending = update(target, "kilo")
        await started.promise
        const early = await Promise.race([pending.then(() => true), Bun.sleep(10).then(() => false)])
        expect(early).toBe(false)
        release.resolve()
        expect((await pending).status).toBe(200)
        expect(await provider(target, workspace.path)).toBe("kilo")
      } finally {
        release.resolve()
        unregister()
      }
    })

    test(`${value ? "httpapi" : "legacy"} update ignores disposal notification failures`, async () => {
      await using config = await tmpdir()
      ;(Global.Path as { config: string }).config = config.path
      await disposeAllInstances()
      const target = app(value)
      const listener = () => {
        throw new Error("listener failed")
      }
      GlobalBus.on("event", listener)
      try {
        expect((await update(target, "kilo")).status).toBe(200)
      } finally {
        GlobalBus.off("event", listener)
      }
    })
  }
})
