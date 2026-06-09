import { describe, expect, test } from "bun:test"
import { hasAtomicChatPlugin } from "@/kilocode/atomic-chat-feature"
import { KilocodeDefaultPlugins } from "@/kilocode/config/default-plugins"

describe("kilocode default atomic chat plugin", () => {
  test("apply adds atomic chat plugin when default plugins are enabled", () => {
    const cfg = { plugin: [] as string[] }
    KilocodeDefaultPlugins.apply(cfg, { disabled: false })
    expect(hasAtomicChatPlugin(cfg.plugin ?? [])).toBe(true)
  })

  test("apply does not add atomic chat plugin when default plugins are disabled", () => {
    const cfg = { plugin: ["global-plugin-1"] as string[] }
    KilocodeDefaultPlugins.apply(cfg, { disabled: true })
    expect(hasAtomicChatPlugin(cfg.plugin ?? [])).toBe(false)
    expect(cfg.plugin).toEqual(["global-plugin-1"])
  })

  test("apply does not duplicate atomic chat plugin", () => {
    const cfg = { plugin: ["@kilocode/plugin-atomic-chat"] as string[] }
    KilocodeDefaultPlugins.apply(cfg, { disabled: false })
    expect(cfg.plugin?.filter((p) => hasAtomicChatPlugin([p])).length).toBe(1)
  })
})
