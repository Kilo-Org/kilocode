import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { Server } from "../../../src/server/server"
import type { Config } from "../../../src/config/config"
import { Filesystem } from "../../../src/util/filesystem"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

// The VS Code provider routing chip reads a workspace's routing from the
// overlay's effective config and compares it with the merged global config.
// These cases pin down that contract for the project layouts the write
// target alone misreads, and for the common layout without an override.

void Log.init({ print: false })
setDefaultTimeout(90_000)

const original = Global.Path.config
const model = "z-ai/glm-4.6"

type Overlay = {
  effective: Config.Info
  global: Config.Info
  targets: { project: { path: string; raw: Record<string, unknown> } }
}

afterEach(async () => {
  ;(Global.Path as { config: string }).config = original
  await disposeAllInstances()
  await resetDatabase()
}, 15_000)

function routing(provider: unknown) {
  return { provider: { kilo: { models: { [model]: { options: { provider } } } } } }
}

function pinned(config: Config.Info) {
  return config.provider?.kilo?.models?.[model]?.options?.provider
}

async function overlay(dir: string) {
  const response = await Server.Default().app.request("/config/overlay?scope=project", {
    headers: { "x-kilo-directory": dir },
  })
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return (await response.json()) as Overlay
}

describe("config overlay routing", () => {
  test("carries a pin from a project file other than the write target", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    ;(Global.Path as { config: string }).config = global.path
    const pin = { order: ["baseten/fp8"], only: ["baseten/fp8"], allow_fallbacks: false }
    await Filesystem.write(path.join(project.path, "kilo.json"), JSON.stringify(routing(pin)))
    await Filesystem.write(path.join(project.path, ".kilo", "kilo.jsonc"), JSON.stringify({ share: "disabled" }))

    const result = await overlay(project.path)

    expect(result.targets.project.path).toBe(path.join(project.path, ".kilo", "kilo.jsonc"))
    expect(pinned(result.targets.project.raw as Config.Info)).toBeUndefined()
    expect(pinned(result.effective)).toEqual(pin)
    expect(pinned(result.global)).toBeUndefined()
  })

  test("drops a global pin a project resets with null", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    ;(Global.Path as { config: string }).config = global.path
    const pin = { order: ["gmicloud/fp8"], only: ["gmicloud/fp8"], allow_fallbacks: false }
    await Filesystem.write(path.join(global.path, "kilo.json"), JSON.stringify(routing(pin)))
    await Filesystem.write(path.join(project.path, "kilo.json"), JSON.stringify(routing(null)))

    const result = await overlay(project.path)

    expect(pinned(result.global)).toEqual(pin)
    expect(pinned(result.effective) ?? undefined).toBeUndefined()
  })

  // Any difference here reads as an override and locks the dropdown.
  test("resolves a global pin unchanged when no project file sets routing", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    ;(Global.Path as { config: string }).config = global.path
    const pin = { order: ["gmicloud/fp8"], only: ["gmicloud/fp8"], allow_fallbacks: false }
    await Filesystem.write(
      path.join(global.path, "kilo.jsonc"),
      JSON.stringify({ model: `kilo/${model}`, ...routing(pin) }),
    )
    await Filesystem.write(
      path.join(project.path, ".kilo", "kilo.jsonc"),
      JSON.stringify({ provider: { kilo: { options: { timeout: 1000 } } } }),
    )

    const result = await overlay(project.path)

    expect(pinned(result.global)).toEqual(pin)
    expect(pinned(result.effective)).toEqual(pin)
  })
})
