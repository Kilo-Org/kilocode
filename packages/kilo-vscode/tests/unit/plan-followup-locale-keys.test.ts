import { describe, expect, test } from "bun:test"
import { dict as ar } from "@kilocode/kilo-i18n/ar"
import { dict as br } from "@kilocode/kilo-i18n/br"
import { dict as bs } from "@kilocode/kilo-i18n/bs"
import { dict as da } from "@kilocode/kilo-i18n/da"
import { dict as de } from "@kilocode/kilo-i18n/de"
import { dict as en } from "@kilocode/kilo-i18n/en"
import { dict as es } from "@kilocode/kilo-i18n/es"
import { dict as fr } from "@kilocode/kilo-i18n/fr"
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

const dicts: Record<string, Record<string, string>> = {
  ar,
  br,
  bs,
  da,
  de,
  en,
  es,
  fr,
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

const keys = [
  "plan.followup.header",
  "plan.followup.question",
  "plan.followup.answer.newSession",
  "plan.followup.answer.newSession.description",
  "plan.followup.answer.continue",
  "plan.followup.answer.continue.description",
]

describe("plan follow-up i18n keys", () => {
  for (const locale of Object.keys(dicts)) {
    test(`${locale} defines every plan.followup.* key`, () => {
      const d = dicts[locale]!
      for (const key of keys) {
        const value = d[key]
        expect(value, `${locale} is missing ${key}`).toBeDefined()
        expect(value, `${locale} has empty value for ${key}`).toBeTruthy()
      }
    })
  }
})
