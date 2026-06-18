import { describe, expect, spyOn, test } from "bun:test"
import { Npm } from "@opencode-ai/core/npm"
import type { ConfigPlugin } from "@/config/plugin"
import { hasAtomicChatPlugin } from "@/kilocode/atomic-chat-feature"
import { KilocodeDefaultPlugins } from "@/kilocode/config/default-plugins"
import { PluginLoader } from "@/plugin/loader"

const atomic = "@kilocode/plugin-atomic-chat"

describe("kilocode default atomic chat plugin", () => {
  test("injects atomic chat without registering an external plugin origin", () => {
    const external: ConfigPlugin.Origin = { spec: "global-plugin", source: "global", scope: "global" }
    const cfg = { plugin: [external.spec], plugin_origins: [external] }

    KilocodeDefaultPlugins.apply(cfg, { disabled: false })

    expect(hasAtomicChatPlugin(cfg.plugin)).toBe(true)
    expect(cfg.plugin_origins).toEqual([external])
  })

  test("does not add atomic chat plugin when default plugins are disabled", () => {
    const cfg = { plugin: ["global-plugin-1"] }
    KilocodeDefaultPlugins.apply(cfg, { disabled: true })
    expect(hasAtomicChatPlugin(cfg.plugin)).toBe(false)
    expect(cfg.plugin).toEqual(["global-plugin-1"])
  })

  test("removes a persisted atomic chat marker from external plugin origins", () => {
    const external: ConfigPlugin.Origin = { spec: "global-plugin", source: "global", scope: "global" }
    const cfg = {
      plugin: [atomic, external.spec],
      plugin_origins: [{ spec: atomic, source: "builtin", scope: "global" as const }, external],
    }

    KilocodeDefaultPlugins.apply(cfg, { disabled: true })

    expect(cfg.plugin).toEqual([atomic, external.spec])
    expect(cfg.plugin_origins).toEqual([external])
  })

  test("does not duplicate atomic chat plugin", () => {
    const cfg = { plugin: [atomic] }
    KilocodeDefaultPlugins.apply(cfg, { disabled: false })
    expect(cfg.plugin.filter((plugin) => hasAtomicChatPlugin([plugin])).length).toBe(1)
  })

  test("treats a versioned atomic chat package as the bundled plugin", () => {
    const spec = `${atomic}@7.3.46`
    const cfg = {
      plugin: [spec],
      plugin_origins: [{ spec, source: "global", scope: "global" as const }],
    }

    KilocodeDefaultPlugins.apply(cfg, { disabled: false })

    expect(cfg.plugin.filter((plugin) => hasAtomicChatPlugin([plugin]))).toEqual([spec])
    expect(cfg.plugin_origins).toEqual([])
  })

  test("treats npm aliases as the bundled plugin", () => {
    for (const spec of [
      `npm:${atomic}`,
      `npm:${atomic}@7.3.46`,
      `atomic@npm:${atomic}`,
      `atomic@npm:${atomic}@7.3.46`,
    ]) {
      const cfg = {
        plugin: [spec],
        plugin_origins: [{ spec, source: "global", scope: "global" as const }],
      }

      KilocodeDefaultPlugins.apply(cfg, { disabled: false })

      expect(cfg.plugin.filter((plugin) => hasAtomicChatPlugin([plugin]))).toEqual([spec])
      expect(cfg.plugin_origins).toEqual([])
    }
  })

  test("keeps aliases named atomic chat with another target external", () => {
    const spec = `${atomic}@npm:other-plugin`
    const origin: ConfigPlugin.Origin = { spec, source: "global", scope: "global" }
    const cfg = { plugin: [spec], plugin_origins: [origin] }

    KilocodeDefaultPlugins.apply(cfg, { disabled: false })

    expect(cfg.plugin).toContain(atomic)
    expect(cfg.plugin_origins).toEqual([origin])
  })

  test("keeps similarly named file plugins external", () => {
    const spec = "file:///tmp/custom-plugin-atomic-chat.ts"
    const origin: ConfigPlugin.Origin = { spec, source: "project", scope: "local" }
    const cfg = { plugin: [spec], plugin_origins: [origin] }

    KilocodeDefaultPlugins.apply(cfg, { disabled: false })

    expect(cfg.plugin).toContain(spec)
    expect(cfg.plugin).toContain(atomic)
    expect(cfg.plugin_origins).toEqual([origin])
  })

  test("external loader skips bundled atomic chat before npm installation", async () => {
    const install = spyOn(Npm, "add").mockRejectedValue(new Error("unexpected install"))
    const specs = [atomic, `${atomic}@7.3.46`, `npm:${atomic}`, `atomic@npm:${atomic}@7.3.46`]

    try {
      const loaded = await PluginLoader.loadExternal({
        items: specs.map((spec) => ({ spec, source: "test", scope: "global" as const })),
        kind: "server",
      })

      expect(loaded).toEqual([])
      expect(install).not.toHaveBeenCalled()
    } finally {
      install.mockRestore()
    }
  })
})
