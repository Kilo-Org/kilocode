// The localized copy of the memory host (Quick Pick and error messages), from the Kilo dictionaries in
// `@kilocode/kilo-i18n`. A locale without a Kilo dictionary falls back to English.
import * as vscode from "vscode"
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
import { selectedLocale } from "../services/i18n"

const dictionaries: Record<string, Record<string, string>> = {
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

export type MemoryCopy = { t: (key: string, vars?: Record<string, string | number>) => string }

export function memoryCopyFor(locale: string): MemoryCopy {
  const table: Record<string, string> = { ...en, ...(dictionaries[locale] ?? {}) }
  return {
    t: (key, vars) =>
      Object.entries(vars ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        table[key] ?? key,
      ),
  }
}

/** The copy in the language the extension shows, read at each call so a language change applies at once. */
export function memoryCopy(): MemoryCopy {
  return memoryCopyFor(selectedLocale(vscode))
}
