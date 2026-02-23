// kilocode_change - new file
// Unified i18n system for VS Code extension host
// Automatically detects locale from VS Code environment

import * as vscode from "vscode"

// Import all language dictionaries
import { dict as dictAr } from "./ar"
import { dict as dictCa } from "./ca"
import { dict as dictCs } from "./cs"
import { dict as dictDe } from "./de"
import { dict as dictEn } from "./en"
import { dict as dictEs } from "./es"
import { dict as dictFr } from "./fr"
import { dict as dictHi } from "./hi"
import { dict as dictId } from "./id"
import { dict as dictIt } from "./it"
import { dict as dictJa } from "./ja"
import { dict as dictKo } from "./ko"
import { dict as dictNl } from "./nl"
import { dict as dictPl } from "./pl"
import { dict as dictPtBr } from "./pt-BR"
import { dict as dictRu } from "./ru"
import { dict as dictSk } from "./sk"
import { dict as dictTh } from "./th"
import { dict as dictTr } from "./tr"
import { dict as dictUk } from "./uk"
import { dict as dictVi } from "./vi"
import { dict as dictZhCn } from "./zh-CN"
import { dict as dictZhTw } from "./zh-TW"

type Locale =
  | "en"
  | "de"
  | "es"
  | "fr"
  | "ja"
  | "ko"
  | "pl"
  | "pt-BR"
  | "ru"
  | "th"
  | "zh-CN"
  | "zh-TW"
  | "ar"
  | "nl"
  | "it"
  | "ca"
  | "cs"
  | "hi"
  | "id"
  | "sk"
  | "tr"
  | "uk"
  | "vi"

// All translations use English as base fallback
const dicts: Record<Locale, Record<string, string>> = {
  en: dictEn,
  de: dictDe,
  es: dictEs,
  fr: dictFr,
  ja: dictJa,
  ko: dictKo,
  pl: dictPl,
  "pt-BR": dictPtBr,
  ru: dictRu,
  th: dictTh,
  "zh-CN": dictZhCn,
  "zh-TW": dictZhTw,
  ar: dictAr,
  nl: dictNl,
  it: dictIt,
  ca: dictCa,
  cs: dictCs,
  hi: dictHi,
  id: dictId,
  sk: dictSk,
  tr: dictTr,
  uk: dictUk,
  vi: dictVi,
}

// Normalize VS Code locale to our supported locales
function normalizeLocale(vscodeLocale: string): Locale {
  const lower = vscodeLocale.toLowerCase()

  // Handle Chinese variants
  if (lower.startsWith("zh")) {
    return lower.includes("tw") || lower.includes("hk") || lower.includes("hant") ? "zh-TW" : "zh-CN"
  }

  // Handle Portuguese variants
  if (lower.startsWith("pt") && lower.includes("br")) {
    return "pt-BR"
  }

  // Extract base language code
  const lang = lower.split("-")[0]

  // Map to supported locales
  const localeMap: Record<string, Locale> = {
    en: "en",
    de: "de",
    es: "es",
    fr: "fr",
    ja: "ja",
    ko: "ko",
    pl: "pl",
    pt: "pt-BR",
    ru: "ru",
    th: "th",
    zh: "zh-CN",
    ar: "ar",
    nl: "nl",
    it: "it",
    ca: "ca",
    cs: "cs",
    hi: "hi",
    id: "id",
    sk: "sk",
    tr: "tr",
    uk: "uk",
    vi: "vi",
  }

  return localeMap[lang] ?? "en"
}

// Get current locale from VS Code environment
function getCurrentLocale(): Locale {
  return normalizeLocale(vscode.env.language)
}

/**
 * Translation function with variable interpolation
 *
 * @param key - Translation key (e.g., "kilocode:autocomplete.statusBar.enabled")
 * @param vars - Optional variables to interpolate (e.g., {count: 5, name: "Test"})
 * @returns Translated string with variables replaced
 *
 * @example
 * t("kilocode:autocomplete.statusBar.tooltip.completionSummary", {
 *   count: 5,
 *   startTime: "10:00",
 *   endTime: "11:00",
 *   cost: "$0.05"
 * })
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const locale = getCurrentLocale()
  const dict = dicts[locale] ?? dicts.en
  let text = dict[key] ?? key

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }

  return text
}
