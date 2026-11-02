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
