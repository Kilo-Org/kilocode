import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "../../src/permission"
import { GlobalBus } from "../../src/bus/global"
import { Server } from "../../src/server/server"
import { registerDisposer } from "../../src/effect/instance-registry"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const root = Global.Path.config

function app() {
  return Server.Default().app
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

async function config(dir: string, value: object) {
  await Bun.write(path.join(dir, "kilo.json"), JSON.stringify(value))
}

async function edit(target: ReturnType<typeof app>, directory: string) {
  const response = await target.request("/config", { headers: { "x-kilo-directory": directory } })
  const body = (await response.json()) as { permission?: unknown }
  return Permission.evaluate(
    "edit",
    "*",
    Permission.fromConfig((body.permission ?? {}) as Parameters<typeof Permission.fromConfig>[0]),
  ).action
}

afterEach(async () => {
  ;(Global.Path as { config: string }).config = root
  await disposeAllInstances()
  await resetDatabase()
})

describe("global config refresh", () => {
  test("update reloads existing instance before responding", async () => {
    await using config = await tmpdir()
    await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
    ;(Global.Path as { config: string }).config = config.path
    await disposeAllInstances()
    const target = app()

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

  test("update ignores disposal notification failures", async () => {
    await using config = await tmpdir()
    ;(Global.Path as { config: string }).config = config.path
    await disposeAllInstances()
    const target = app()
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

  test("detects external global config edits", async () => {
    await using global = await tmpdir()
    await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
    ;(Global.Path as { config: string }).config = global.path
    await config(global.path, { permission: { edit: "ask" } })
    await disposeAllInstances()
    const target = app()

    expect(await edit(target, workspace.path)).toBe("ask")

    await config(global.path, { permission: { edit: { "*": "allow" } } })

    expect(await edit(target, workspace.path)).toBe("allow")
  })
})
