import { dict as ar } from "./autocomplete/ar"
import { dict as br } from "./autocomplete/br"
import { dict as bs } from "./autocomplete/bs"
import { dict as da } from "./autocomplete/da"
import { dict as de } from "./autocomplete/de"
import { dict as en } from "./autocomplete/en"
import { type dict as enDict } from "./autocomplete/en"
import { dict as es } from "./autocomplete/es"
import { dict as fa } from "./autocomplete/fa"
import { dict as fr } from "./autocomplete/fr"
import { dict as it } from "./autocomplete/it"
import { dict as ja } from "./autocomplete/ja"
import { dict as ko } from "./autocomplete/ko"
import { dict as nl } from "./autocomplete/nl"
import { dict as no } from "./autocomplete/no"
import { dict as pl } from "./autocomplete/pl"
import { dict as ru } from "./autocomplete/ru"
import { dict as th } from "./autocomplete/th"
import { dict as tr } from "./autocomplete/tr"
import { dict as uk } from "./autocomplete/uk"
import { dict as zh } from "./autocomplete/zh"
import { dict as zht } from "./autocomplete/zht"

const bundles: Record<string, Record<string, string>> = {
  ar,
  br,
  bs,
  da,
  de,
  en,
  es,
  fa,
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
  const cfg = vscode.workspace.getConfiguration("kilo-code.v2")
  const lang = cfg.get<string>("language")
  return resolveLocale(lang || vscode.env.language)
}

export function translate(
  locale: string,
  key: keyof typeof enDict | string,
  vars?: Record<string, string | number>,
): string {
  const translations: Record<string, string> = { ...en, ...(bundles[resolveLocale(locale)] ?? {}) }
  let text = translations[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return text
}

export function t(key: keyof typeof enDict | string, vars?: Record<string, string | number>): string {
  const locale = selectedLocale(require("vscode") as typeof import("vscode"))
  return translate(locale, key, vars)
}
