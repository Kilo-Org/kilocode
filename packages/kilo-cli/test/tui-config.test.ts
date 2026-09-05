import { expect, test } from "bun:test"
import { link, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Config } from "@opencode-ai/tui/config"
import { createTuiConfig } from "../src/tui-config"
import type { Layout } from "../src/paths"

test("persists only presentation settings and restores them after a restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-tui-config-test-"))
  try {
    const input = makeLayout(root)
    const defaults: Config.Info = {
      plugins: [{ package: "kilo.preview", options: { identity: "kilo2" } }],
      session: { terminal: false },
    }
    const first = createTuiConfig(input, defaults)

    await first.update((draft) => {
      draft.theme = { name: "custom" }
      draft.animations = true
      draft.model = "provider/model"
      draft.providers = { external: { apiKey: "secret" } }
      draft.experimental = { unsafe: true }
      draft.plugins = [{ package: "unapproved" }]
    })

    const stored = await Bun.file(input.tuiConfig).json()
    expect(stored).toMatchObject({ theme: { name: "custom" }, animations: true, session: { terminal: false } })
    expect(stored).not.toHaveProperty("model")
    expect(stored).not.toHaveProperty("providers")
    expect(stored).not.toHaveProperty("experimental")
    expect(stored).not.toHaveProperty("plugins")
    expect(await Bun.file(input.config).exists()).toBe(false)

    const restarted = createTuiConfig(input, defaults)
    await expect(restarted.get()).resolves.toMatchObject({
      theme: { name: "custom" },
      animations: true,
      plugins: defaults.plugins,
      session: { terminal: false },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("does not replace a malformed settings file with defaults", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-tui-config-test-"))
  try {
    const input = makeLayout(root)
    await mkdir(path.dirname(input.tuiConfig), { recursive: true })
    const malformed = "{ not valid JSON\n"
    await Bun.write(input.tuiConfig, malformed)

    const service = createTuiConfig(input, { plugins: [{ package: "kilo.preview" }] })
    await expect(service.get()).rejects.toThrow(`Invalid preview TUI config: ${input.tuiConfig}`)
    await expect(service.update((draft) => (draft.animations = true))).rejects.toThrow("Invalid preview TUI config")
    expect(await Bun.file(input.tuiConfig).text()).toBe(malformed)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const kind of ["symlink", "hardlink"] as const) {
  test(`rejects a ${kind} TUI settings file`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-tui-config-test-"))
    try {
      const input = makeLayout(root)
      await mkdir(path.dirname(input.tuiConfig), { recursive: true })
      const target = path.join(root, "settings-target.json")
      await Bun.write(target, JSON.stringify({ animations: true }))
      if (kind === "symlink") await symlink(target, input.tuiConfig)
      else await link(target, input.tuiConfig)

      await expect(createTuiConfig(input, { plugins: [{ package: "kilo.preview" }] }).get()).rejects.toThrow("Refusing")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

function makeLayout(root: string): Layout {
  const paths = {
    home: os.homedir(),
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}
