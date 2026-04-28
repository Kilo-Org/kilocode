import { describe, it, expect } from "bun:test"
import { dict as appEn } from "../../webview-ui/src/i18n/en"
import { dict as appZh } from "../../webview-ui/src/i18n/zh"
import { dict as appZht } from "../../webview-ui/src/i18n/zht"
import { dict as appKo } from "../../webview-ui/src/i18n/ko"
import { dict as appDe } from "../../webview-ui/src/i18n/de"
import { dict as appEs } from "../../webview-ui/src/i18n/es"
import { dict as appFr } from "../../webview-ui/src/i18n/fr"
import { dict as appDa } from "../../webview-ui/src/i18n/da"
import { dict as appJa } from "../../webview-ui/src/i18n/ja"
import { dict as appPl } from "../../webview-ui/src/i18n/pl"
import { dict as appRu } from "../../webview-ui/src/i18n/ru"
import { dict as appAr } from "../../webview-ui/src/i18n/ar"
import { dict as appNo } from "../../webview-ui/src/i18n/no"
import { dict as appBr } from "../../webview-ui/src/i18n/br"
import { dict as appTh } from "../../webview-ui/src/i18n/th"
import { dict as appBs } from "../../webview-ui/src/i18n/bs"
import { dict as appTr } from "../../webview-ui/src/i18n/tr"
import { dict as appNl } from "../../webview-ui/src/i18n/nl"
import { dict as appUk } from "../../webview-ui/src/i18n/uk"
import { dict as amEn } from "../../webview-ui/agent-manager/i18n/en"
import { dict as amZh } from "../../webview-ui/agent-manager/i18n/zh"
import { dict as amZht } from "../../webview-ui/agent-manager/i18n/zht"
import { dict as amKo } from "../../webview-ui/agent-manager/i18n/ko"
import { dict as amDe } from "../../webview-ui/agent-manager/i18n/de"
import { dict as amEs } from "../../webview-ui/agent-manager/i18n/es"
import { dict as amFr } from "../../webview-ui/agent-manager/i18n/fr"
import { dict as amDa } from "../../webview-ui/agent-manager/i18n/da"
import { dict as amJa } from "../../webview-ui/agent-manager/i18n/ja"
import { dict as amPl } from "../../webview-ui/agent-manager/i18n/pl"
import { dict as amRu } from "../../webview-ui/agent-manager/i18n/ru"
import { dict as amAr } from "../../webview-ui/agent-manager/i18n/ar"
import { dict as amNo } from "../../webview-ui/agent-manager/i18n/no"
import { dict as amBr } from "../../webview-ui/agent-manager/i18n/br"
import { dict as amTh } from "../../webview-ui/agent-manager/i18n/th"
import { dict as amBs } from "../../webview-ui/agent-manager/i18n/bs"
import { dict as amTr } from "../../webview-ui/agent-manager/i18n/tr"
import { dict as amNl } from "../../webview-ui/agent-manager/i18n/nl"
import { dict as amUk } from "../../webview-ui/agent-manager/i18n/uk"

const PREFIX = "agentManager."

const locales = {
  en: amEn,
  zh: amZh,
  zht: amZht,
  ko: amKo,
  de: amDe,
  es: amEs,
  fr: amFr,
  da: amDa,
  ja: amJa,
  pl: amPl,
  ru: amRu,
  ar: amAr,
  no: amNo,
  br: amBr,
  th: amTh,
  bs: amBs,
  tr: amTr,
  nl: amNl,
  uk: amUk,
}

const appLocales = {
  en: appEn,
  zh: appZh,
  zht: appZht,
  ko: appKo,
  de: appDe,
  es: appEs,
  fr: appFr,
  da: appDa,
  ja: appJa,
  pl: appPl,
  ru: appRu,
  ar: appAr,
  no: appNo,
  br: appBr,
  th: appTh,
  bs: appBs,
  tr: appTr,
  nl: appNl,
  uk: appUk,
}

function placeholders(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g))
    .flatMap((match) => (match[1] ? [match[1]] : []))
    .sort()
}

describe("Agent Manager i18n split", () => {
  it("keeps agent manager keys out of general locale dictionaries", () => {
    for (const [locale, dict] of Object.entries(appLocales)) {
      const keys = Object.keys(dict)
      expect(
        keys.some((key) => key.startsWith(PREFIX)),
        `locale ${locale} contains agent manager keys`,
      ).toBeFalse()
    }
  })

  it("keeps every agent manager locale dictionary scoped to agentManager.* keys", () => {
    for (const [locale, dict] of Object.entries(locales)) {
      const keys = Object.keys(dict)
      expect(keys.length, `locale ${locale} should have agent manager keys`).toBeGreaterThan(0)
      const invalid = keys.filter((key) => !key.startsWith(PREFIX))
      expect(invalid, `locale ${locale} has non-agent-manager keys`).toEqual([])
    }
  })

  it("keeps every agent manager locale keyset aligned with english", () => {
    const baseKeys = Object.keys(amEn)

    for (const [locale, dict] of Object.entries(locales)) {
      const keySet = new Set(Object.keys(dict))
      const missing = baseKeys.filter((key) => !keySet.has(key))
      const extra = Array.from(keySet).filter((key) => !(key in amEn))

      expect(missing, `locale ${locale} is missing agent manager keys`).toEqual([])
      expect(extra, `locale ${locale} has unexpected agent manager keys`).toEqual([])
    }
  })

  it("keeps interpolation placeholders aligned with english", () => {
    for (const [locale, dict] of Object.entries(locales)) {
      if (locale === "en") continue

      for (const [key, value] of Object.entries(amEn)) {
        const localized = (dict as Record<string, string>)[key]
        expect(localized, `missing key ${key} in locale ${locale}`).toBeDefined()
        if (!localized) continue

        const baseVars = placeholders(value)
        const localeVars = placeholders(localized)
        expect(localeVars, `placeholder mismatch for ${key} in locale ${locale}`).toEqual(baseVars)
      }
    }
  })

  it("contains required core keys in every locale", () => {
    const required = [
      "agentManager.local",
      "agentManager.session.new",
      "agentManager.apply.error",
      "agentManager.import.failed",
    ]

    for (const [locale, dict] of Object.entries(locales)) {
      for (const key of required) {
        expect((dict as Record<string, string>)[key], `missing key ${key} in locale ${locale}`).toBeDefined()
      }
    }
  })
})
