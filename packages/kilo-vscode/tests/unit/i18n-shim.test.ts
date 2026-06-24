import { describe, it, expect } from "bun:test"
import { load } from "../../src/services/autocomplete/i18n"
import { t } from "../../src/services/autocomplete/shims/i18n"

describe("t()", () => {
  it("returns translated string for known key", () => {
    const result = t("kilocode:autocomplete.statusBar.enabled")
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toBe("kilocode:autocomplete.statusBar.enabled")
  })

  it("returns the key itself for unknown key", () => {
    expect(t("nonexistent.key.that.does.not.exist")).toBe("nonexistent.key.that.does.not.exist")
  })

  it("returns empty string for empty key", () => {
    expect(t("")).toBe("")
  })

  it("interpolates a single variable", () => {
    const result = t("kilocode:autocomplete.statusBar.tooltip.noUsableProvider", {
      providers: "OpenAI, Anthropic",
      command: "command:kilo-code.new.settingsButtonClicked",
    })
    expect(result).toContain("OpenAI, Anthropic")
    expect(result).not.toContain("{{providers}}")
  })

  it("interpolates multiple variables", () => {
    const result = t("kilocode:autocomplete.statusBar.tooltip.completionSummary", {
      count: "5",
      startTime: "10:00",
      endTime: "11:00",
      cost: "$0.05",
    })
    expect(result).toContain("5")
    expect(result).toContain("10:00")
    expect(result).toContain("11:00")
    expect(result).toContain("$0.05")
    expect(result).not.toContain("{{")
  })

  it("interpolates numeric variable as string", () => {
    const result = t("kilocode:autocomplete.statusBar.tooltip.noUsableProvider", {
      providers: 42 as unknown as string,
    })
    expect(result).toContain("42")
  })

  it("leaves unreferenced vars intact in template", () => {
    const key = "kilocode:autocomplete.statusBar.tooltip.noUsableProvider"
    const result = t(key, { unrelated: "value" })
    expect(result).toContain("{{providers}}")
  })

  it("returns the raw key when called without vars on a template key", () => {
    const result = t("kilocode:autocomplete.statusBar.tooltip.noUsableProvider")
    expect(result).toContain("{{providers}}")
  })

  it("handles empty vars object (no interpolation)", () => {
    const result = t("kilocode:autocomplete.statusBar.enabled", {})
    expect(typeof result).toBe("string")
    expect(result).not.toContain("{{")
  })
})

describe("load()", () => {
  it("loads localized autocomplete errors", () => {
    const translations = load("de-DE")
    expect(translations["kilocode:autocomplete.creditsExhausted.message"]).toContain("Mögliche Ursachen")
    expect(translations["kilocode:autocomplete.authError.message"]).toContain("API-Schlüssel")
  })

  it("resolves regional locale variants", () => {
    expect(load("pt-BR")["kilocode:autocomplete.authError.message"]).toContain("autenticação")
    expect(load("zh-TW")["kilocode:autocomplete.authError.message"]).toContain("身分驗證")
    expect(load("nb-NO")["kilocode:autocomplete.authError.message"]).toContain("autentiseringsproblem")
  })

  it("falls back to English for unsupported locales", () => {
    expect(load("unknown")["kilocode:autocomplete.statusBar.enabled"]).toBe("$(kilo-logo) Autocomplete")
  })
})
