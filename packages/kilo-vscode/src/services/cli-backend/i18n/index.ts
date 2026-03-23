import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as nl } from "./nl"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as en } from "./en"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"
import { type dict as enDict } from "./en"

const bundles: Record<string, Record<string, string>> = {
  ar,
  br,
  bs,
  nl,
  da,
  de,
  en,
  es,
  fr,
  ja,
  ko,
  no,
  pl,
  ru,
  th,
  zh,
  zht,
}

function resolveLocale(lang: string): string {
  const lower = lang.toLowerCase()
  if (lower.startsWith("zh")) return lower.includes("hant") ? "zht" : "zh"
  if (lower.startsWith("nb") || lower.startsWith("nn")) return "no"
  if (lower.startsWith("pt")) return "br"
  for (const key of Object.keys(bundles)) {
    if (lower.startsWith(key)) return key
  }
  return "en"
}

function loadTranslations(): Record<string, string> {
  // vscode.env.language is available at module load time in the extension host
  const vscode = require("vscode") as typeof import("vscode")
  const locale = resolveLocale(vscode.env.language)
  return { ...en, ...(bundles[locale] ?? {}) }
}

const translations: Record<string, string> = loadTranslations()

export function t(key: keyof typeof enDict, vars?: Record<string, string | number>): string {
  let text = translations[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return text
}
