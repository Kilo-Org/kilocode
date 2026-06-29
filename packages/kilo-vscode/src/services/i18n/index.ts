import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as en } from "./en"
import { type dict as enDict } from "./en"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as it } from "./it"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as nl } from "./nl"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as tr } from "./tr"
import { dict as uk } from "./uk"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

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

export function resolveLocale(lang: string | undefined): string {
  if (!lang) return "en"
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

export function selectedLocale(vscode: typeof import("vscode")): string {
  const cfg = vscode.workspace.getConfiguration("kilo-code")
  const lang = cfg.get<string>("language")
  return resolveLocale(lang || vscode.env.language)
}

function load(): Record<string, string> {
  const vscode = require("vscode") as typeof import("vscode")
  const locale = selectedLocale(vscode)
  return { ...en, ...(bundles[locale] ?? {}) }
}

export function t(key: keyof typeof enDict | string, vars?: Record<string, string | number>): string {
  const translations = load()
  let text = translations[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return text
}
