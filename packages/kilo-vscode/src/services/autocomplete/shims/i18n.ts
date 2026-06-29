import { dict as ar } from "../i18n/ar"
import { dict as br } from "../i18n/br"
import { dict as bs } from "../i18n/bs"
import { dict as da } from "../i18n/da"
import { dict as de } from "../i18n/de"
import { dict as en } from "../i18n/en"
import { type dict as enDict } from "../i18n/en"
import { dict as es } from "../i18n/es"
import { dict as fr } from "../i18n/fr"
import { dict as it } from "../i18n/it"
import { dict as ja } from "../i18n/ja"
import { dict as ko } from "../i18n/ko"
import { dict as nl } from "../i18n/nl"
import { dict as no } from "../i18n/no"
import { dict as pl } from "../i18n/pl"
import { dict as ru } from "../i18n/ru"
import { dict as th } from "../i18n/th"
import { dict as tr } from "../i18n/tr"
import { dict as uk } from "../i18n/uk"
import { dict as zh } from "../i18n/zh"
import { dict as zht } from "../i18n/zht"

const bundles: Record<string, Record<string, string>> = {
  ar,
  br,
  bs,
  da,
  de,
  en,
  es,
  fr,
  it,
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

export function resolveLocale(lang: string): string {
  const lower = lang.toLowerCase()
  if (lower.startsWith("zh")) {
    if (lower === "zht") return "zht"
    const traditional =
      lower.includes("hant") || lower.includes("-tw") || lower.includes("-hk") || lower.includes("-mo")
    return traditional ? "zht" : "zh"
  }
  if (lower.startsWith("nb") || lower.startsWith("nn")) return "no"
  if (lower.startsWith("pt")) return "br"
  for (const key of Object.keys(bundles)) {
    if (lower.startsWith(key)) return key
  }
  return "en"
}

function load(): Record<string, string> {
  const vscode = require("vscode") as typeof import("vscode")
  const locale = resolveLocale(vscode.env.language)
  return { ...en, ...(bundles[locale] ?? {}) }
}

const translations: Record<string, string> = load()

export function t(key: keyof typeof enDict | string, vars?: Record<string, string | number>): string {
  let text = translations[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return text
}
