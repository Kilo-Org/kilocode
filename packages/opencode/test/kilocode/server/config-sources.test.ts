import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

type Source = {
  order: number
  kind: string
  scope: string
  label: string
  source: string
  path?: string
  exists: boolean
  editable: boolean
  reason?: string
}

type Body = {
  sources: Source[]
}

const env = {
  KILO_CONFIG: process.env.KILO_CONFIG,
  KILO_CONFIG_CONTENT: process.env.KILO_CONFIG_CONTENT,
  KILO_CONFIG_DIR: process.env.KILO_CONFIG_DIR,
  KILO_DISABLE_PROJECT_CONFIG: process.env.KILO_DISABLE_PROJECT_CONFIG,
  KILO_TEST_MANAGED_CONFIG_DIR: process.env.KILO_TEST_MANAGED_CONFIG_DIR,
  flagConfig: Flag.KILO_CONFIG,
}

afterEach(async () => {
  restore()
  await disposeAllInstances()
  await resetDatabase()
})

function restore() {
  set("KILO_CONFIG", env.KILO_CONFIG)
  set("KILO_CONFIG_CONTENT", env.KILO_CONFIG_CONTENT)
  set("KILO_CONFIG_DIR", env.KILO_CONFIG_DIR)
  set("KILO_DISABLE_PROJECT_CONFIG", env.KILO_DISABLE_PROJECT_CONFIG)
  set("KILO_TEST_MANAGED_CONFIG_DIR", env.KILO_TEST_MANAGED_CONFIG_DIR)
  Flag.KILO_CONFIG = env.flagConfig
}

function set(key: keyof typeof process.env, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

async function sources(dir: string) {
  const response = await Server.Default().app.request("/config/sources", {
    headers: { "x-kilo-directory": dir },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as Body
}

function order(body: Body, file: string) {
  const hit = body.sources.find((source) => source.path === file)
  expect(hit).toBeDefined()
  return hit!.order
}

describe("config source routes", () => {
  test("lists global JSON and JSONC files in runtime precedence order", async () => {
    await using globalTmp = await tmpdir()
    await using project = await tmpdir()
    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      const names = ["config.json", "opencode.json", "opencode.jsonc", "kilo.json", "kilo.jsonc"]
      for (const name of names) await Bun.write(path.join(globalTmp.path, name), "{}")

      const body = await sources(project.path)
      const positions = names.map((name) => order(body, path.join(globalTmp.path, name)))
      expect(positions).toEqual(positions.toSorted((a, b) => a - b))
    } finally {
      ;(Global.Path as { config: string }).config = previous
    }
  })

  test("lists ancestor project config before a nearer legacy config", async () => {
    await using tmp = await tmpdir({ git: true })
    const nested = path.join(tmp.path, "packages", "app")
    const ancestor = path.join(tmp.path, "kilo.json")
    const nearer = path.join(nested, "opencode.json")
    await fs.mkdir(nested, { recursive: true })
    await Bun.write(ancestor, "{}")
    await Bun.write(nearer, "{}")

    const body = await sources(nested)
    expect(order(body, ancestor)).toBeLessThan(order(body, nearer))
  })

  test("lists source metadata in load order without config contents", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "env.json"), "{}")
        await Bun.write(path.join(dir, "opencode.json"), "{}")
        await Bun.write(path.join(dir, "kilo.json"), "{}")

        for (const root of [".opencode", ".kilocode", ".kilo"]) {
          const local = path.join(dir, root)
          await fs.mkdir(local, { recursive: true })
          await Bun.write(path.join(local, "kilo.jsonc"), "{}")
        }
        await Bun.write(path.join(dir, ".kilo", "opencode.json"), "{}")
        await Bun.write(path.join(dir, ".kilo", "opencode.jsonc"), "{}")
        await Bun.write(path.join(dir, ".kilo", "kilo.json"), "{}")

        const extra = path.join(dir, "extra")
        await fs.mkdir(extra, { recursive: true })
        await Bun.write(path.join(extra, "opencode.json"), "{}")

        const managed = path.join(dir, "managed")
        await fs.mkdir(managed, { recursive: true })
        await Bun.write(path.join(managed, "kilo.json"), "{}")
      },
    })

    const envFile = path.join(tmp.path, "env.json")
    const legacyProjectFile = path.join(tmp.path, "opencode.json")
    const projectFile = path.join(tmp.path, "kilo.json")
    const opencodeFile = path.join(tmp.path, ".opencode", "kilo.jsonc")
    const kilocodeFile = path.join(tmp.path, ".kilocode", "kilo.jsonc")
    const legacyConfigJsonFile = path.join(tmp.path, ".kilo", "opencode.json")
    const configFile = path.join(tmp.path, ".kilo", "kilo.jsonc")
    const legacyConfigFile = path.join(tmp.path, ".kilo", "opencode.jsonc")
    const configJsonFile = path.join(tmp.path, ".kilo", "kilo.json")
    const extraFile = path.join(tmp.path, "extra", "opencode.json")
    const managedFile = path.join(tmp.path, "managed", "kilo.json")

    process.env.KILO_CONFIG = envFile
    Flag.KILO_CONFIG = envFile
    process.env.KILO_CONFIG_CONTENT = '{"username":"secret-inline-value"}'
    process.env.KILO_CONFIG_DIR = path.join(tmp.path, "extra")
    process.env.KILO_TEST_MANAGED_CONFIG_DIR = path.join(tmp.path, "managed")

    const body = await sources(tmp.path)
    const inline = body.sources.find((source) => source.source === "KILO_CONFIG_CONTENT")

    expect(order(body, envFile)).toBeLessThan(order(body, projectFile))
    expect(order(body, legacyProjectFile)).toBeLessThan(order(body, projectFile))
    expect(order(body, projectFile)).toBeLessThan(order(body, kilocodeFile))
    expect(order(body, kilocodeFile)).toBeLessThan(order(body, configFile))
    expect(body.sources.some((source) => source.path === opencodeFile)).toBe(false)
    expect(order(body, legacyConfigJsonFile)).toBeLessThan(order(body, legacyConfigFile))
    expect(order(body, legacyConfigFile)).toBeLessThan(order(body, configFile))
    expect(order(body, legacyConfigFile)).toBeLessThan(order(body, configJsonFile))
    expect(order(body, configJsonFile)).toBeLessThan(order(body, configFile))
    expect(order(body, configFile)).toBeLessThan(order(body, extraFile))
    expect(inline?.order).toBeGreaterThan(order(body, extraFile))
    expect(inline?.order).toBeLessThan(order(body, managedFile))

    expect(body.sources.find((source) => source.path === configFile)).toMatchObject({
      kind: "config-dir-file",
      scope: "project",
      exists: true,
      editable: true,
    })
    expect(body.sources.find((source) => source.path === managedFile)).toMatchObject({
      kind: "managed-file",
      scope: "managed",
      exists: true,
      editable: false,
    })
    expect(JSON.stringify(body)).not.toContain("secret-inline-value")
  })

  test("shows project config disabled by environment", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "kilo.json"), "{}")
        await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
        await Bun.write(path.join(dir, ".kilo", "kilo.json"), "{}")
      },
    })

    process.env.KILO_DISABLE_PROJECT_CONFIG = "1"

    const body = await sources(tmp.path)

    expect(body.sources.some((source) => source.path === path.join(tmp.path, "kilo.json"))).toBe(false)
    expect(body.sources.some((source) => source.path === path.join(tmp.path, ".kilo", "kilo.json"))).toBe(false)
    expect(body.sources.find((source) => source.source === "KILO_DISABLE_PROJECT_CONFIG")).toMatchObject({
      kind: "runtime-env",
      scope: "env",
      exists: true,
      editable: false,
    })
  })
})
