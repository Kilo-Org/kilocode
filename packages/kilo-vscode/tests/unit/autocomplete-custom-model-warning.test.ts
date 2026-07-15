/**
 * Guards the custom-model autocomplete warning.
 *
 * Curated autocomplete models are known to support FIM. A model from a
 * configured (BYOK) provider is unverified: a chat-only model returns prose
 * or fenced markdown instead of insertable code. When such a model is
 * selected, the Models settings tab must show a visible warning card
 * (requested in Kilo-Org/kilocode#4498).
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

import { isCustomAutocompleteSelection } from "../../webview-ui/src/components/settings/autocomplete-model-selector"
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

const TITLE_KEY = "settings.autocomplete.model.customWarning.title"
const DESCRIPTION_KEY = "settings.autocomplete.model.customWarning.description"

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

describe("custom autocomplete model detection", () => {
  it("does not flag curated Kilo Gateway models", () => {
    expect(isCustomAutocompleteSelection("kilo", "mistralai/codestral-2508")).toBe(false)
    expect(isCustomAutocompleteSelection("kilo", "inception/mercury-next-edit")).toBe(false)
  })

  it("does not flag curated direct BYOK models", () => {
    expect(isCustomAutocompleteSelection("mistral", "codestral-2508")).toBe(false)
    expect(isCustomAutocompleteSelection("inception", "mercury-edit-2")).toBe(false)
  })

  it("does not flag the unset (server default) state", () => {
    expect(isCustomAutocompleteSelection(undefined, undefined)).toBe(false)
    expect(isCustomAutocompleteSelection("lmstudio", undefined)).toBe(false)
    expect(isCustomAutocompleteSelection(undefined, "qwen2.5-coder-1.5b")).toBe(false)
  })

  it("flags configured-provider models as custom", () => {
    expect(isCustomAutocompleteSelection("lmstudio", "qwen2.5-coder-1.5b")).toBe(true)
    expect(isCustomAutocompleteSelection("ollama", "qwen2.5-coder:1.5b-base")).toBe(true)
  })
})

describe("custom autocomplete model warning copy", () => {
  it("states the FIM requirement and the chat symptom in English", () => {
    expect(en[TITLE_KEY]).toBe("Unverified autocomplete model")
    expect(en[DESCRIPTION_KEY]).toBe(
      "Kilo Code has not tested this model for autocomplete. It must support fill-in-the-middle (FIM) through its provider's completions endpoint. If suggestions appear as prose or fenced Markdown, the model is responding as chat. Switch to a FIM-capable model.",
    )
  })

  it("exists in every locale and keeps the FIM technical token", () => {
    for (const [locale, dict] of Object.entries(locales)) {
      expect(dict[TITLE_KEY], `locale ${locale} is missing ${TITLE_KEY}`).toBeTruthy()
      expect(dict[DESCRIPTION_KEY], `locale ${locale} is missing ${DESCRIPTION_KEY}`).toBeTruthy()
      expect(dict[DESCRIPTION_KEY], `locale ${locale} dropped the FIM token from ${DESCRIPTION_KEY}`).toContain("FIM")
    }
  })
})

describe("custom autocomplete model warning rendering", () => {
  const modelsTab = fs.readFileSync(
    path.resolve(import.meta.dir, "../../webview-ui/src/components/settings/ModelsTab.tsx"),
    "utf8",
  )

  it("renders a warning card gated on the custom-model check", () => {
    expect(modelsTab).toContain("isCustomAutocompleteSelection")
    expect(modelsTab).toContain('data-slot="autocomplete-custom-model-warning"')
    expect(modelsTab).toMatch(/<Card\s+variant="warning"\s+role="alert"/)
    expect(modelsTab).toContain('language.t("settings.autocomplete.model.customWarning.title")')
    expect(modelsTab).toContain('language.t("settings.autocomplete.model.customWarning.description")')
  })

  it("announces the warning to assistive technology", () => {
    expect(modelsTab).toMatch(/role="alert"[^>]*data-slot="autocomplete-custom-model-warning"/)
  })
})
