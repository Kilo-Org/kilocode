/**
 * Guards the FIM-only autocomplete model hint.
 *
 * The autocomplete model description must warn users that only
 * fill-in-the-middle (FIM) models work for inline completions, because
 * chat-only models return conversational prose or fenced markdown instead
 * of raw insertable code. The hint renders visibly in the Models settings
 * row and also feeds the model selector's aria-describedby.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

import { dict as en } from "../../webview-ui/src/i18n/en"
import { dict as ar } from "../../webview-ui/src/i18n/ar"
import { dict as br } from "../../webview-ui/src/i18n/br"
import { dict as bs } from "../../webview-ui/src/i18n/bs"
import { dict as da } from "../../webview-ui/src/i18n/da"
import { dict as de } from "../../webview-ui/src/i18n/de"
import { dict as es } from "../../webview-ui/src/i18n/es"
import { dict as fr } from "../../webview-ui/src/i18n/fr"
import { dict as it_ } from "../../webview-ui/src/i18n/it"
import { dict as ja } from "../../webview-ui/src/i18n/ja"
import { dict as ko } from "../../webview-ui/src/i18n/ko"
import { dict as nl } from "../../webview-ui/src/i18n/nl"
import { dict as no } from "../../webview-ui/src/i18n/no"
import { dict as pl } from "../../webview-ui/src/i18n/pl"
import { dict as ru } from "../../webview-ui/src/i18n/ru"
import { dict as th } from "../../webview-ui/src/i18n/th"
import { dict as tr } from "../../webview-ui/src/i18n/tr"
import { dict as uk } from "../../webview-ui/src/i18n/uk"
import { dict as zh } from "../../webview-ui/src/i18n/zh"
import { dict as zht } from "../../webview-ui/src/i18n/zht"

const KEY = "settings.autocomplete.model.description"

const locales: Record<string, Record<string, string>> = {
  en,
  ar,
  br,
  bs,
  da,
  de,
  es,
  fr,
  it: it_,
  ja,
  ko,
  nl,
  no,
  pl,
  ru,
  th,
  tr,
  uk,
  zh,
  zht,
}

describe("autocomplete FIM-only model hint", () => {
  it("states the FIM requirement and the chat-only limitation in English", () => {
    expect(en[KEY]).toBe("Select a fill-in-the-middle (FIM) model. Chat-only models are not supported.")
  })

  it("keeps the FIM technical token in every locale", () => {
    for (const [locale, dict] of Object.entries(locales)) {
      expect(dict[KEY], `locale ${locale} is missing ${KEY}`).toBeTruthy()
      expect(dict[KEY], `locale ${locale} dropped the FIM token from ${KEY}`).toContain("FIM")
    }
  })

  it("renders the hint visibly and assistively in the Models settings row", () => {
    const modelsTab = fs.readFileSync(
      path.resolve(import.meta.dir, "../../webview-ui/src/components/settings/ModelsTab.tsx"),
      "utf8",
    )
    const uses = modelsTab.match(/language\.t\("settings\.autocomplete\.model\.description"\)/g) ?? []
    // Once for the visible SettingsRow subtitle, once for the selector's assistive description.
    expect(uses.length).toBeGreaterThanOrEqual(2)
  })

  it("wires the selector description into aria-describedby", () => {
    const modelSelector = fs.readFileSync(
      path.resolve(import.meta.dir, "../../webview-ui/src/components/shared/ModelSelector.tsx"),
      "utf8",
    )
    expect(modelSelector).toContain("model-selector-assistive")
    expect(modelSelector).toContain("aria-describedby")
    expect(modelSelector).toMatch(/props\.description \? descriptionID : undefined/)
  })
})
