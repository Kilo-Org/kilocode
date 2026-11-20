import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { KILO_SETTING_KEYS } from "../src/settings-host"

const properties = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")).contributes.configuration
  .properties as Record<string, { default?: unknown }>

const AUTOCOMPLETE_KEYS = [
  "autocomplete.enableAutoTrigger",
  "autocomplete.enableSmartInlineTaskKeybinding",
  "autocomplete.enableChatAutocomplete",
  "autocomplete.provider",
  "autocomplete.model",
]

describe("KILO_SETTING_KEYS", () => {
  it("contains the five autocomplete keys so Reset All Settings clears them", () => {
    for (const key of AUTOCOMPLETE_KEYS) {
      expect(KILO_SETTING_KEYS as readonly string[]).toContain(key)
    }
  })

  it("contains the diff markdown key so Reset All Settings clears it", () => {
    expect(KILO_SETTING_KEYS as readonly string[]).toContain("diff.renderMarkdown")
  })

  it("contains the chat content width limit key and defaults it to true", () => {
    expect(KILO_SETTING_KEYS as readonly string[]).toContain("chat.limitContentWidth")
    expect(properties["kilo-code.v2.chat.limitContentWidth"]?.default).toBe(true)
  })

  it("wires limitChatContentWidth to the chat-view data attribute and CSS readable width", () => {
    const settings = readFileSync(join(__dirname, "../webview-ui/src/v2/kilo-settings.ts"), "utf8")
    const session = readFileSync(join(__dirname, "../webview-ui/src/v2/session-view.tsx"), "utf8")
    const layout = readFileSync(join(__dirname, "../webview-ui/src/styles/chat-layout.css"), "utf8")

    expect(settings).toContain('kiloSettings()["chat.limitContentWidth"] !== false')
    expect(session).toContain('data-limit-content-width={limitChatContentWidth() ? "true" : "false"}')
    expect(layout).toContain('.chat-view[data-limit-content-width="false"]')
    expect(layout).toContain("--chat-readable-width: 100%;")
  })

  it("declares every key in package.json contributes.configuration.properties", () => {
    for (const key of KILO_SETTING_KEYS) {
      expect(properties[`kilo-code.v2.${key}`]).toBeDefined()
    }
  })

  it("documents the autocomplete defaults", () => {
    expect(properties["kilo-code.v2.autocomplete.enableAutoTrigger"]?.default).toBe(true)
    expect(properties["kilo-code.v2.autocomplete.enableSmartInlineTaskKeybinding"]?.default).toBe(false)
    expect(properties["kilo-code.v2.autocomplete.enableChatAutocomplete"]?.default).toBe(false)
    expect(properties["kilo-code.v2.autocomplete.provider"]?.default).toBeUndefined()
    expect(properties["kilo-code.v2.autocomplete.model"]?.default).toBeUndefined()
  })
})
