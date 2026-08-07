import { describe, expect, test } from "bun:test"
import { defaultConfig } from "@kilocode/world/client"
import { resolve } from "../../src/kilocode/tool/world-config"

describe("world tool config", () => {
  test("does not inherit browser settings from a previous project", () => {
    const base = defaultConfig()
    const first = resolve({
      world: {
        browser: {
          headless: !base.browser.headless,
          use_system_chrome: true,
          args: ["--disable-notifications"],
        },
      },
    })
    const second = resolve({})

    expect(first.browser).toMatchObject({
      headless: !base.browser.headless,
      useSystemChrome: true,
      args: base.browser.args,
    })
    expect(second).toEqual(base)
  })

  test("accepts executable settings only from global config", () => {
    const project = { world: { browser: { executable_path: "/tmp/project", args: ["--project"] } } }
    const global = { world: { browser: { executable_path: "/tmp/global", args: ["--global"] } } }

    expect(resolve(project).browser).toMatchObject({ args: [] })
    expect(resolve(project, global).browser).toMatchObject({ executablePath: "/tmp/global", args: ["--global"] })
  })

  test("fills partial project settings from defaults", () => {
    const base = defaultConfig()
    const config = resolve({ world: { browser: { timeout_ms: 12_345 } } })

    expect(config.browser).toEqual({
      ...base.browser,
      timeoutMs: 12_345,
    })
  })
})
