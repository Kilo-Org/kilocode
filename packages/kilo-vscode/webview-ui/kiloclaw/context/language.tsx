// KiloClaw lightweight language context
//
// Self-contained i18n for the KiloClaw panel. Does not depend on
// VSCodeProvider/ServerProvider — locale comes from the extension host
// via the claw context, falling back to navigator.language then "en".

import { createContext, createEffect, createMemo, useContext, type JSX } from "solid-js"
import { normalizeLocale, RTL_LOCALES, localeToBcp47, resolveTemplate } from "../../src/context/language-utils"
import type { Locale } from "../../src/context/language-utils"
import { dict as en } from "../i18n/en"
import { dict as ar } from "../i18n/ar"
import { dict as br } from "../i18n/br"
import { dict as bs } from "../i18n/bs"
import { dict as da } from "../i18n/da"
import { dict as de } from "../i18n/de"
import { dict as es } from "../i18n/es"
import { dict as fr } from "../i18n/fr"
import { dict as ja } from "../i18n/ja"
import { dict as ko } from "../i18n/ko"
import { dict as nl } from "../i18n/nl"
import { dict as no } from "../i18n/no"
import { dict as pl } from "../i18n/pl"
import { dict as ru } from "../i18n/ru"
import { dict as th } from "../i18n/th"
import { dict as tr } from "../i18n/tr"
import { dict as zh } from "../i18n/zh"
import { dict as uk } from "../i18n/uk"
import { dict as zht } from "../i18n/zht"

const dicts: Record<Locale, Record<string, string>> = {
  en,
  ar: { ...en, ...ar },
  br: { ...en, ...br },
  bs: { ...en, ...bs },
  da: { ...en, ...da },
  de: { ...en, ...de },
  es: { ...en, ...es },
  fr: { ...en, ...fr },
  ja: { ...en, ...ja },
  ko: { ...en, ...ko },
  nl: { ...en, ...nl },
  no: { ...en, ...no },
  pl: { ...en, ...pl },
  ru: { ...en, ...ru },
  th: { ...en, ...th },
  tr: { ...en, ...tr },
  uk: { ...en, ...uk },
  zh: { ...en, ...zh },
  zht: { ...en, ...zht },
}

type LanguageCtx = {
  t: (key: string, params?: Record<string, string | number | boolean | undefined>) => string
}

const LanguageContext = createContext<LanguageCtx>()

export function KiloClawLanguageProvider(props: { locale: () => string | undefined; children: JSX.Element }) {
  const resolved = createMemo<Locale>(() => {
    const ext = props.locale()
    if (ext) return normalizeLocale(ext)
    if (typeof navigator !== "undefined" && navigator.language) return normalizeLocale(navigator.language)
    return "en"
  })

  const dict = createMemo(() => dicts[resolved()] ?? dicts.en)

  // Update <html lang> and <html dir> when locale changes
  createEffect(() => {
    const loc = resolved()
    document.documentElement.lang = localeToBcp47(loc)
    document.documentElement.dir = RTL_LOCALES.has(loc) ? "rtl" : "ltr"
  })

  const t = (key: string, params?: Record<string, string | number | boolean | undefined>) => {
    const text = dict()[key] ?? key
    return resolveTemplate(text, params)
  }

  return <LanguageContext.Provider value={{ t }}>{props.children}</LanguageContext.Provider>
}

export function useKiloClawLanguage(): LanguageCtx {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error("useKiloClawLanguage must be used within KiloClawLanguageProvider")
  return ctx
}
