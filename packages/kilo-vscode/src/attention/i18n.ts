// The attention copy the extension host shows itself: the VS Code notification and the native OS toast. It is Kilo
// copy, so it lives in `@kilocode/kilo-i18n` with every other Kilo string, and follows the language the webviews use.
import { env, workspace } from "vscode"
import { dict as ar } from "@kilocode/kilo-i18n/ar"
import { dict as br } from "@kilocode/kilo-i18n/br"
import { dict as bs } from "@kilocode/kilo-i18n/bs"
import { dict as da } from "@kilocode/kilo-i18n/da"
import { dict as de } from "@kilocode/kilo-i18n/de"
import { dict as en } from "@kilocode/kilo-i18n/en"
import { dict as es } from "@kilocode/kilo-i18n/es"
import { dict as fr } from "@kilocode/kilo-i18n/fr"
import { dict as it } from "@kilocode/kilo-i18n/it"
import { dict as ja } from "@kilocode/kilo-i18n/ja"
import { dict as ko } from "@kilocode/kilo-i18n/ko"
import { dict as nl } from "@kilocode/kilo-i18n/nl"
import { dict as no } from "@kilocode/kilo-i18n/no"
import { dict as pl } from "@kilocode/kilo-i18n/pl"
import { dict as ru } from "@kilocode/kilo-i18n/ru"
import { dict as th } from "@kilocode/kilo-i18n/th"
import { dict as tr } from "@kilocode/kilo-i18n/tr"
import { dict as uk } from "@kilocode/kilo-i18n/uk"
import { dict as zh } from "@kilocode/kilo-i18n/zh"
import { dict as zht } from "@kilocode/kilo-i18n/zht"
import { resolveLocale } from "../services/i18n"

export type AttentionKey = Extract<keyof typeof en, `attention.${string}`>

const bundles: Record<string, Partial<Record<string, string>>> = {
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

/** The copy for `key` in the Kilo language setting, or the VS Code display language when it is unset. */
export function t(key: AttentionKey): string {
  const locale = resolveLocale(workspace.getConfiguration("kilo-code.v2").get<string>("language") || env.language)
  return bundles[locale]?.[key] ?? en[key]
}
