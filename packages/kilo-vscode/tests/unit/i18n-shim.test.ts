import { describe, it, expect } from "bun:test"
import { resolveLocale, selectedLocale, t, translate } from "../../src/services/i18n"

describe("extension host i18n", () => {
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

  it("resolves supported locale variants", () => {
    expect(resolveLocale("de-DE")).toBe("de")
    expect(resolveLocale("pt-BR")).toBe("br")
    expect(resolveLocale("nb-NO")).toBe("no")
    expect(resolveLocale("zh-CN")).toBe("zh")
    expect(resolveLocale("zh-Hant")).toBe("zht")
    expect(resolveLocale("zh-TW")).toBe("zht")
  })

  it("falls back to English for unsupported locales", () => {
    expect(resolveLocale("sv-SE")).toBe("en")
  })

  it("prefers Kilo new language setting over VS Code language", () => {
    const vscode = {
      env: { language: "en" },
      workspace: {
        getConfiguration: (section: string) => ({
          get: () => (section === "kilo-code.new" ? "de" : undefined),
        }),
      },
    } as unknown as typeof import("vscode")

    expect(selectedLocale(vscode)).toBe("de")
  })

  it("uses VS Code language when Kilo language setting is automatic", () => {
    const vscode = {
      env: { language: "nl" },
      workspace: {
        getConfiguration: () => ({
          get: () => undefined,
        }),
      },
    } as unknown as typeof import("vscode")

    expect(selectedLocale(vscode)).toBe("nl")
  })

  it("translates status bar tooltip copy for German", () => {
    const text = translate("de", "kilocode:autocomplete.statusBar.tooltip.completionSummary", {
      count: 1,
      startTime: "12:25:24",
      endTime: "12:25:26",
      cost: "$0.00",
    })

    expect(text).not.toContain("Performed")
    expect(text).toContain("Vervollständigungen")
  })
})
