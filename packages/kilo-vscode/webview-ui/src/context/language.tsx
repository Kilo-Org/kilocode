/**
 * Language context
 * Provides i18n translations for kilo-ui components.
 * Merges UI translations from @opencode-ai/ui and Kilo overrides from @kilocode/kilo-i18n.
 *
 * Locale priority: user override → VS Code display language → browser language → "en"
 */

import { createSignal, createMemo, createEffect, onCleanup, ParentComponent, Accessor } from "solid-js"
import { I18nProvider, pluralCategory, pluralKey } from "@kilocode/kilo-ui/context"
import type { UiI18nKey, UiI18nParams, UiI18nPluralKey } from "@kilocode/kilo-ui/context"
import { dict as uiEn } from "@kilocode/kilo-ui/i18n/en"
import { dict as appEn } from "../i18n/en"
import { dict as amEn } from "../../agent-manager/i18n/en"
import { dict as kiloEn } from "@kilocode/kilo-i18n/en"
import { useVSCode } from "./vscode"
import { normalizeLocale as _normalizeLocale, resolveTemplate as _resolveTemplate } from "./language-utils"

export type { Locale } from "./language-utils"
export { LOCALES } from "./language-utils"
import type { Locale } from "./language-utils"
import { LOCALES, RTL_LOCALES, localeToBcp47 } from "./language-utils"

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  zht: "繁體中文",
  ko: "한국어",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  da: "Dansk",
  ja: "日本語",
  pl: "Polski",
  ru: "Русский",
  ar: "العربية",
  no: "Norsk",
  br: "Português (Brasil)",
  th: "ภาษาไทย",
  bs: "Bosanski",
  tr: "Türkçe",
  nl: "Nederlands",
  uk: "Українська",
  it: "Italiano",
  fa: "فارسی",
}

const base = { ...appEn, ...uiEn, ...kiloEn }
const english: Record<string, string> = { ...base, ...amEn }
const cache: Partial<Record<Locale, Record<string, string>>> = { en: english }
const loads: Partial<Record<Locale, Promise<Record<string, string> | undefined>>> = {}
type Dictionary = { default: (base: Record<string, string>) => Record<string, string> }

function load(locale: Locale) {
  if (locale === "en") return Promise.resolve(english)
  return (loads[locale] ??= (import(`./language-dictionaries/${locale}.ts`) as Promise<Dictionary>)
    .then((module) => (cache[locale] ??= module.default(base)))
    .catch((err) => {
      delete loads[locale]
      console.error("[Kilo New] Failed to load language", { locale, err })
      return undefined
    }))
}

function normalizeLocale(lang: string): Locale {
  return _normalizeLocale(lang)
}

function resolveTemplate(text: string, params?: UiI18nParams) {
  return _resolveTemplate(text, params as Record<string, string | number | boolean | undefined>)
}

interface LanguageProviderProps {
  vscodeLanguage?: Accessor<string | undefined>
  languageOverride?: Accessor<string | undefined>
}

export const LanguageProvider: ParentComponent<LanguageProviderProps> = (props) => {
  const vscode = useVSCode()
  const [userOverride, setUserOverride] = createSignal<Locale | "">("")
  const [retry, setRetry] = createSignal(0)

  // Initialize from extension-side override
  createEffect(() => {
    const override = props.languageOverride?.()
    if (override) {
      setUserOverride(normalizeLocale(override))
    }
  })

  // Resolved locale: user override → VS Code language → browser language → "en"
  const target = createMemo<Locale>(() => {
    const override = userOverride()
    if (override) {
      return override
    }
    const vscodeLang = props.vscodeLanguage?.()
    if (vscodeLang) {
      return normalizeLocale(vscodeLang)
    }
    if (typeof navigator !== "undefined" && navigator.language) {
      return normalizeLocale(navigator.language)
    }
    return "en"
  })

  // Keep translations, Intl locale, and direction on the same loaded dictionary.
  const [active, activate] = createSignal({ locale: "en" as Locale, dict: english })
  const locale = createMemo(() => active().locale)
  const dict = createMemo(() => active().dict)
  createEffect(() => {
    retry()
    const next = target()
    const cached = cache[next]
    if (cached) {
      activate({ locale: next, dict: cached })
      return
    }
    let stale = false
    onCleanup(() => {
      stale = true
    })
    void load(next).then((dict) => {
      if (stale || !dict) return
      activate({ locale: next, dict })
    })
  })

  // Update <html lang> and <html dir> when locale changes
  createEffect(() => {
    const loc = locale()
    document.documentElement.lang = localeToBcp47(loc)
    document.documentElement.dir = RTL_LOCALES.has(loc) ? "rtl" : "ltr"
  })

  const t = (key: UiI18nKey, params?: UiI18nParams) => {
    const text = dict()[key] ?? english[key] ?? String(key)
    return resolveTemplate(text, params)
  }
  const plural = (key: UiI18nPluralKey, count: number, params?: UiI18nParams) =>
    t(pluralKey(key, pluralCategory(localeToBcp47(locale()), count)), { ...params, count })

  const setLocale = (next: Locale | "") => {
    setUserOverride(next)
    const lang = target()
    if (!cache[lang] && !loads[lang]) setRetry((value) => value + 1)
    vscode.postMessage({ type: "setLanguage", locale: next })
  }

  return (
    <LanguageContext.Provider
      value={{ locale, setLocale, userOverride, t: t as (key: string, params?: UiI18nParams) => string }}
    >
      {/* Shared UI formats dates and numbers with Intl from this value, so it
          must be a BCP-47 tag (Kilo's "zht" is not one). */}
      <I18nProvider value={{ locale: () => localeToBcp47(locale()), t, plural }}>{props.children}</I18nProvider>
    </LanguageContext.Provider>
  )
}

// Expose locale + setLocale for the LanguageTab
import { createContext, useContext } from "solid-js"

export interface LanguageContextValue {
  locale: Accessor<Locale>
  setLocale: (locale: Locale | "") => void
  userOverride: Accessor<Locale | "">
  t: (key: string, params?: UiI18nParams) => string
}

export const LanguageContext = createContext<LanguageContextValue>()

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return ctx
}
