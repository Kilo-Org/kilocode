import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  SETTINGS_ENTRIES,
  SETTINGS_TABS,
  highlightSegments,
  searchSettings,
} from "../../webview-ui/src/components/settings/settings-search"
import { dict as en } from "../../webview-ui/src/i18n/en"
import { dict as agentManagerEn } from "../../webview-ui/agent-manager/i18n/en"

const labels = { ...en, ...agentManagerEn } as Record<string, string>
const translate = (key: string) => labels[key] ?? key

describe("settings search index", () => {
  it("maps every entry to a known tab", () => {
    const tabs = new Set(SETTINGS_TABS.map((tab) => tab.id))
    for (const entry of SETTINGS_ENTRIES) {
      expect(tabs.has(entry.tab)).toBe(true)
    }
  })

  it("references existing English title keys", () => {
    for (const entry of SETTINGS_ENTRIES) {
      expect(labels[entry.titleKey]).toBeDefined()
    }
    for (const tab of SETTINGS_TABS) {
      expect(labels[tab.titleKey]).toBeDefined()
    }
  })

  it("references existing explicit description keys", () => {
    for (const entry of SETTINGS_ENTRIES) {
      if (!entry.descriptionKey) continue
      expect(labels[entry.descriptionKey]).toBeDefined()
    }
  })
})

// The index duplicates settings the tabs render inline, so guard against it
// rotting: every listed key must still appear in a settings component.
describe("settings search index drift guard", () => {
  const settingsDir = join(dirname(fileURLToPath(import.meta.url)), "../../webview-ui/src/components/settings")
  const skip = new Set([
    "settings-search.ts",
    "settings-search-index.ts",
    "SettingsSearch.tsx",
    "SettingsSearchResults.tsx",
  ])
  const sources = () =>
    readdirSync(settingsDir)
      .filter((name) => /\.(ts|tsx)$/.test(name) && !skip.has(name))
      .map((name) => readFileSync(join(settingsDir, name), "utf8"))
      .join("\n")

  it("lists only title keys the settings UI still renders", () => {
    const source = sources()
    const missing = SETTINGS_ENTRIES.filter((entry) => !source.includes(`"${entry.titleKey}"`)).map(
      (entry) => entry.titleKey,
    )
    expect(missing).toEqual([])
  })

  it("lists only tab keys the settings UI still renders", () => {
    const source = sources()
    const missing = SETTINGS_TABS.filter((tab) => !source.includes(`"${tab.titleKey}"`)).map((tab) => tab.titleKey)
    expect(missing).toEqual([])
  })
})

describe("searchSettings", () => {
  it("returns nothing for an empty query", () => {
    expect(searchSettings("", translate)).toEqual([])
    expect(searchSettings("   ", translate)).toEqual([])
  })

  it("returns nothing when no setting matches", () => {
    expect(searchSettings("zzzzzznotasetting", translate)).toEqual([])
  })

  it("ranks a title match above a tab-only match", () => {
    const results = searchSettings("font", translate)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].titleKey).toBe("settings.display.fontSize.title")
    expect(results[0].tab).toBe("display")
    expect(results[0].tabOnly).toBe(false)
  })

  it("matches description text", () => {
    const results = searchSettings("username", translate)
    expect(results.some((result) => result.titleKey === "settings.display.username.title")).toBe(true)
  })

  it("matches keywords", () => {
    const results = searchSettings("playwright", translate)
    expect(results.some((result) => result.tab === "browser")).toBe(true)
  })

  it("requires every token to match", () => {
    expect(searchSettings("display font", translate).some((result) => result.tab === "display")).toBe(true)
    expect(searchSettings("display zzzz", translate)).toEqual([])
  })

  it("falls back to a tab-only result when only the category matches", () => {
    const results = searchSettings("providers", translate)
    const tab = results.find((result) => result.tab === "providers")
    expect(tab?.tabOnly).toBe(true)
  })

  it("restricts results to the supplied visible tabs", () => {
    const tabs = SETTINGS_TABS.filter((tab) => tab.id !== "indexing")
    const results = searchSettings("embeddings", translate, SETTINGS_ENTRIES, tabs)
    expect(results.some((result) => result.tab === "indexing")).toBe(false)
  })

  it("resolves display titles and descriptions", () => {
    const result = searchSettings("font", translate)[0]
    expect(result.title).toBe("Font Size")
    expect(typeof result.description).toBe("string")
  })

  // The results pane groups matches by tab and indexes the flat list for
  // keyboard selection, so a tab must not reappear after another tab's results.
  it("keeps each tab's matches contiguous", () => {
    for (const query of ["browser", "model", "provider", "api", "mode", "font"]) {
      const seen = new Set<string>()
      let previous = ""
      for (const result of searchSettings(query, translate)) {
        if (result.tab === previous) continue
        expect(seen.has(result.tab)).toBe(false)
        seen.add(result.tab)
        previous = result.tab
      }
    }
  })
})

describe("highlightSegments", () => {
  it("returns the whole text when the query is empty", () => {
    expect(highlightSegments("Font Size", "")).toEqual([{ text: "Font Size", match: false }])
  })

  it("marks matched tokens only", () => {
    const parts = highlightSegments("Default Model", "model")
    expect(parts).toEqual([
      { text: "Default ", match: false },
      { text: "Model", match: true },
    ])
  })

  it("marks every token and is case-insensitive", () => {
    const parts = highlightSegments("Image Generation Model", "image model")
    expect(parts.filter((part) => part.match).map((part) => part.text.toLowerCase())).toEqual(["image", "model"])
  })
})
