/**
 * Translation key validation
 *
 * 1. Ensures every string-literal translation key passed to a t() function
 *    actually exists in the corresponding English dictionary.
 * 2. Ensures every English key has a translation in all other locale files.
 *
 * Three independent key pools are checked:
 *   - Webview (sidebar + agent manager): merged from app, ui, kilo-i18n, agent-manager dicts
 *   - CLI backend (extension-side server-manager): cli-backend/i18n dict
 *   - Extension host: services/i18n aggregate dict
 *
 * Dynamic keys (template literals, variables) are intentionally skipped —
 * only string literals are validated.
 */

import { describe, it, expect } from "bun:test"
import { Glob } from "bun"
import path from "node:path"

// ── Webview dictionaries ────────────────────────────────────────────────────

// Layer 1: app-local (sidebar)
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
import { dict as appIt } from "../../webview-ui/src/i18n/it"
import { dict as appFa } from "../../webview-ui/src/i18n/fa"

// Layer 2: upstream UI (@opencode-ai/ui re-exported via @kilocode/kilo-ui)
import { dict as uiEn } from "../../../ui/src/i18n/en"
import { dict as uiZh } from "../../../ui/src/i18n/zh"
import { dict as uiZht } from "../../../ui/src/i18n/zht"
import { dict as uiKo } from "../../../ui/src/i18n/ko"
import { dict as uiDe } from "../../../ui/src/i18n/de"
import { dict as uiEs } from "../../../ui/src/i18n/es"
import { dict as uiFr } from "../../../ui/src/i18n/fr"
import { dict as uiDa } from "../../../ui/src/i18n/da"
import { dict as uiJa } from "../../../ui/src/i18n/ja"
import { dict as uiPl } from "../../../ui/src/i18n/pl"
import { dict as uiRu } from "../../../ui/src/i18n/ru"
import { dict as uiAr } from "../../../ui/src/i18n/ar"
import { dict as uiNo } from "../../../ui/src/i18n/no"
import { dict as uiBr } from "../../../ui/src/i18n/br"
import { dict as uiTh } from "../../../ui/src/i18n/th"
import { dict as uiBs } from "../../../ui/src/i18n/bs"
import { dict as uiTr } from "../../../ui/src/i18n/tr"
import { dict as uiNl } from "../../../ui/src/i18n/nl"
import { dict as uiUk } from "../../../ui/src/i18n/uk"
import { dict as uiIt } from "../../../ui/src/i18n/it"

// Layer 3: kilo-i18n overrides
import { dict as kiloEn } from "../../../kilo-i18n/src/en"
import { dict as kiloZh } from "../../../kilo-i18n/src/zh"
import { dict as kiloZht } from "../../../kilo-i18n/src/zht"
import { dict as kiloKo } from "../../../kilo-i18n/src/ko"
import { dict as kiloDe } from "../../../kilo-i18n/src/de"
import { dict as kiloEs } from "../../../kilo-i18n/src/es"
import { dict as kiloFr } from "../../../kilo-i18n/src/fr"
import { dict as kiloDa } from "../../../kilo-i18n/src/da"
import { dict as kiloJa } from "../../../kilo-i18n/src/ja"
import { dict as kiloPl } from "../../../kilo-i18n/src/pl"
import { dict as kiloRu } from "../../../kilo-i18n/src/ru"
import { dict as kiloAr } from "../../../kilo-i18n/src/ar"
import { dict as kiloNo } from "../../../kilo-i18n/src/no"
import { dict as kiloBr } from "../../../kilo-i18n/src/br"
import { dict as kiloTh } from "../../../kilo-i18n/src/th"
import { dict as kiloBs } from "../../../kilo-i18n/src/bs"
import { dict as kiloTr } from "../../../kilo-i18n/src/tr"
import { dict as kiloNl } from "../../../kilo-i18n/src/nl"
import { dict as kiloUk } from "../../../kilo-i18n/src/uk"
import { dict as kiloIt } from "../../../kilo-i18n/src/it"

// Layer 4: agent manager (locale alignment already tested in agent-manager-i18n-split.test.ts)
import { dict as amEn } from "../../webview-ui/agent-manager/i18n/en"
import { dict as amTr } from "../../webview-ui/agent-manager/i18n/tr"
import { dict as amNl } from "../../webview-ui/agent-manager/i18n/nl"
import { dict as amUk } from "../../webview-ui/agent-manager/i18n/uk"

// ── Extension-side dictionaries ─────────────────────────────────────────────

import { dict as cliEn } from "../../src/services/cli-backend/i18n/en"
import { dict as cliZh } from "../../src/services/cli-backend/i18n/zh"
import { dict as cliZht } from "../../src/services/cli-backend/i18n/zht"
import { dict as cliDe } from "../../src/services/cli-backend/i18n/de"
import { dict as cliEs } from "../../src/services/cli-backend/i18n/es"
import { dict as cliFr } from "../../src/services/cli-backend/i18n/fr"
import { dict as cliDa } from "../../src/services/cli-backend/i18n/da"
import { dict as cliJa } from "../../src/services/cli-backend/i18n/ja"
import { dict as cliKo } from "../../src/services/cli-backend/i18n/ko"
import { dict as cliPl } from "../../src/services/cli-backend/i18n/pl"
import { dict as cliRu } from "../../src/services/cli-backend/i18n/ru"
import { dict as cliAr } from "../../src/services/cli-backend/i18n/ar"
import { dict as cliNo } from "../../src/services/cli-backend/i18n/no"
import { dict as cliBr } from "../../src/services/cli-backend/i18n/br"
import { dict as cliTh } from "../../src/services/cli-backend/i18n/th"
import { dict as cliBs } from "../../src/services/cli-backend/i18n/bs"
import { dict as cliTr } from "../../src/services/cli-backend/i18n/tr"
import { dict as cliNl } from "../../src/services/cli-backend/i18n/nl"
import { dict as cliUk } from "../../src/services/cli-backend/i18n/uk"
import { dict as cliIt } from "../../src/services/cli-backend/i18n/it"
import { dict as cliFa } from "../../src/services/cli-backend/i18n/fa"

import { dict as hostEn } from "../../src/services/i18n/en"
import { dict as hostZh } from "../../src/services/i18n/zh"
import { dict as hostZht } from "../../src/services/i18n/zht"
import { dict as hostDe } from "../../src/services/i18n/de"
import { dict as hostEs } from "../../src/services/i18n/es"
import { dict as hostFr } from "../../src/services/i18n/fr"
import { dict as hostDa } from "../../src/services/i18n/da"
import { dict as hostJa } from "../../src/services/i18n/ja"
import { dict as hostKo } from "../../src/services/i18n/ko"
import { dict as hostPl } from "../../src/services/i18n/pl"
import { dict as hostRu } from "../../src/services/i18n/ru"
import { dict as hostAr } from "../../src/services/i18n/ar"
import { dict as hostNo } from "../../src/services/i18n/no"
import { dict as hostBr } from "../../src/services/i18n/br"
import { dict as hostTh } from "../../src/services/i18n/th"
import { dict as hostBs } from "../../src/services/i18n/bs"
import { dict as hostTr } from "../../src/services/i18n/tr"
import { dict as hostNl } from "../../src/services/i18n/nl"
import { dict as hostUk } from "../../src/services/i18n/uk"
import { dict as hostIt } from "../../src/services/i18n/it"
import { dict as hostFa } from "../../src/services/i18n/fa"

// ── Locale maps ─────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dir, "../..")

const appLocales: Record<string, Record<string, string>> = {
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
  it: appIt,
  fa: appFa,
}

const kiloLocales: Record<string, Record<string, string>> = {
  en: kiloEn,
  zh: kiloZh,
  zht: kiloZht,
  ko: kiloKo,
  de: kiloDe,
  es: kiloEs,
  fr: kiloFr,
  da: kiloDa,
  ja: kiloJa,
  pl: kiloPl,
  ru: kiloRu,
  ar: kiloAr,
  no: kiloNo,
  br: kiloBr,
  th: kiloTh,
  bs: kiloBs,
  tr: kiloTr,
  nl: kiloNl,
  uk: kiloUk,
  it: kiloIt,
}

const uiLocales: Record<string, Record<string, string>> = {
  en: uiEn,
  zh: uiZh,
  zht: uiZht,
  ko: uiKo,
  de: uiDe,
  es: uiEs,
  fr: uiFr,
  da: uiDa,
  ja: uiJa,
  pl: uiPl,
  ru: uiRu,
  ar: uiAr,
  no: uiNo,
  br: uiBr,
  th: uiTh,
  bs: uiBs,
  tr: uiTr,
  nl: uiNl,
  uk: uiUk,
  it: uiIt,
}

const cliLocales: Record<string, Record<string, string>> = {
  en: cliEn,
  zh: cliZh,
  zht: cliZht,
  de: cliDe,
  es: cliEs,
  fr: cliFr,
  da: cliDa,
  ja: cliJa,
  ko: cliKo,
  pl: cliPl,
  ru: cliRu,
  ar: cliAr,
  no: cliNo,
  br: cliBr,
  th: cliTh,
  bs: cliBs,
  tr: cliTr,
  nl: cliNl,
  uk: cliUk,
  it: cliIt,
  fa: cliFa,
}

const hostLocales: Record<string, Record<string, string>> = {
  en: hostEn,
  zh: hostZh,
  zht: hostZht,
  de: hostDe,
  es: hostEs,
  fr: hostFr,
  da: hostDa,
  ja: hostJa,
  ko: hostKo,
  pl: hostPl,
  ru: hostRu,
  ar: hostAr,
  no: hostNo,
  br: hostBr,
  th: hostTh,
  bs: hostBs,
  tr: hostTr,
  nl: hostNl,
  uk: hostUk,
  it: hostIt,
  fa: hostFa,
}

// Merge webview dictionaries in the same priority order as language.tsx
const webviewKeys = new Set(Object.keys({ ...appEn, ...uiEn, ...kiloEn, ...amEn }))
const cliKeys = new Set(Object.keys(cliEn))
const hostKeys = new Set(Object.keys(hostEn))

// ── File scanning ───────────────────────────────────────────────────────────

interface Missing {
  file: string
  line: number
  key: string
}

/**
 * Regex to match t("key") / t('key') calls, including multiline.
 *
 * The `s` (dotAll) flag lets `\s*` span newlines so that calls like:
 *   t(
 *     "key"
 *   )
 * are captured. Runs against the entire file content, not line-by-line.
 */
const T_CALL = /(?:^|[^a-zA-Z_$])t\(\s*(?:["'])([^"']+)["']/gs

function offsetToLine(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++
  }
  return line
}

function extractKeys(content: string): Array<{ line: number; key: string }> {
  const results: Array<{ line: number; key: string }> = []
  let match: RegExpExecArray | null
  T_CALL.lastIndex = 0
  while ((match = T_CALL.exec(content)) !== null) {
    const key = match[1]
    if (key) results.push({ line: offsetToLine(content, match.index), key })
  }
  return results
}

async function collectFiles(glob: Glob, dir: string): Promise<string[]> {
  const files: string[] = []
  for await (const entry of glob.scan({ cwd: dir, absolute: true })) {
    files.push(entry)
  }
  return files
}

// ── Webview files ───────────────────────────────────────────────────────────

async function findWebviewMissing(): Promise<Missing[]> {
  const glob = new Glob("**/*.{ts,tsx}")
  const dirs = [path.join(ROOT, "webview-ui/src"), path.join(ROOT, "webview-ui/agent-manager")]

  const files: string[] = []
  for (const dir of dirs) {
    files.push(...(await collectFiles(glob, dir)))
  }

  // Exclude i18n dictionary files themselves and storybook files
  const filtered = files.filter((f) => !f.includes("/i18n/") && !f.includes(".stories.") && !f.includes("/stories/"))

  const missing: Missing[] = []
  for (const file of filtered) {
    const content = await Bun.file(file).text()
    for (const { line, key } of extractKeys(content)) {
      if (!webviewKeys.has(key)) {
        missing.push({ file: path.relative(ROOT, file), line, key })
      }
    }
  }
  return missing
}

// ── CLI backend files ───────────────────────────────────────────────────────

async function findCliBackendMissing(): Promise<Missing[]> {
  const glob = new Glob("**/*.ts")
  const dir = path.join(ROOT, "src/services/cli-backend")

  const files = (await collectFiles(glob, dir)).filter((f) => !f.includes("/i18n/"))

  const missing: Missing[] = []
  for (const file of files) {
    const content = await Bun.file(file).text()
    for (const { line, key } of extractKeys(content)) {
      if (!cliKeys.has(key)) {
        missing.push({ file: path.relative(ROOT, file), line, key })
      }
    }
  }
  return missing
}

// ── Extension host files ────────────────────────────────────────────────────

async function findHostMissing(): Promise<Missing[]> {
  const glob = new Glob("**/*.ts")
  const dir = path.join(ROOT, "src/services/autocomplete")

  const files = (await collectFiles(glob, dir)).filter((f) => !f.includes("/shims/"))

  const missing: Missing[] = []
  for (const file of files) {
    const content = await Bun.file(file).text()
    for (const { line, key } of extractKeys(content)) {
      if (!hostKeys.has(key)) {
        missing.push({ file: path.relative(ROOT, file), line, key })
      }
    }
  }
  return missing
}

// ── Locale completeness helpers ─────────────────────────────────────────────

function findMissingLocaleKeys(
  en: Record<string, string>,
  locales: Record<string, Record<string, string>>,
): Array<{ locale: string; key: string }> {
  const base = Object.keys(en)
  const results: Array<{ locale: string; key: string }> = []
  for (const [locale, dict] of Object.entries(locales)) {
    if (locale === "en") continue
    const keys = new Set(Object.keys(dict))
    for (const key of base) {
      if (!keys.has(key)) {
        results.push({ locale, key })
      }
    }
  }
  return results
}

function formatLocaleReport(items: Array<{ locale: string; key: string }>): string {
  return items.map((m) => `  [${m.locale}] "${m.key}"`).join("\n")
}

// ── Tests ───────────────────────────────────────────────────────────────────

function formatReport(missing: Missing[]): string {
  return missing.map((m) => `  ${m.file}:${m.line} — "${m.key}"`).join("\n")
}

describe("i18n key validation — no missing translation keys", () => {
  it("webview: all t() string literal keys exist in merged dictionaries", async () => {
    const missing = await findWebviewMissing()
    if (missing.length > 0) {
      expect(
        missing,
        `Found ${missing.length} translation key(s) not present in any dictionary:\n${formatReport(missing)}`,
      ).toEqual([])
    }
    expect(missing).toEqual([])
  })

  it("cli-backend: all t() string literal keys exist in cli-backend dictionary", async () => {
    const missing = await findCliBackendMissing()
    if (missing.length > 0) {
      expect(
        missing,
        `Found ${missing.length} translation key(s) not present in cli-backend dictionary:\n${formatReport(missing)}`,
      ).toEqual([])
    }
    expect(missing).toEqual([])
  })

  it("extension host: autocomplete t() string literal keys exist in aggregate dictionary", async () => {
    const missing = await findHostMissing()
    if (missing.length > 0) {
      expect(
        missing,
        `Found ${missing.length} translation key(s) not present in extension host dictionary:\n${formatReport(missing)}`,
      ).toEqual([])
    }
    expect(missing).toEqual([])
  })
})

describe("i18n locale completeness — every English key exists in all locales", () => {
  it("shared UI: every English key has a translation in all locales", () => {
    const missing = findMissingLocaleKeys(uiEn, uiLocales)
    if (missing.length > 0) {
      expect(
        missing,
        `Found ${missing.length} missing shared UI translation(s):\n${formatLocaleReport(missing)}`,
      ).toEqual([])
    }
    expect(missing).toEqual([])
  })

  it("sidebar app: every English key has a translation in all locales", () => {
    const missing = findMissingLocaleKeys(appEn, appLocales)
    if (missing.length > 0) {
      expect(
        missing,
        `Found ${missing.length} missing sidebar translation(s):\n${formatLocaleReport(missing)}`,
      ).toEqual([])
    }
    expect(missing).toEqual([])
  })

  it("kilo-i18n: every English key has a translation in all locales", () => {
    const missing = findMissingLocaleKeys(kiloEn, kiloLocales)
    if (missing.length > 0) {
      expect(
        missing,
        `Found ${missing.length} missing kilo-i18n translation(s):\n${formatLocaleReport(missing)}`,
      ).toEqual([])
    }
    expect(missing).toEqual([])
  })

  it("cli-backend: every English key has a translation in all locales", () => {
    const missing = findMissingLocaleKeys(cliEn, cliLocales)
    if (missing.length > 0) {
      expect(
        missing,
        `Found ${missing.length} missing cli-backend translation(s):\n${formatLocaleReport(missing)}`,
      ).toEqual([])
    }
    expect(missing).toEqual([])
  })

  it("extension host: every English key has a translation in all locales", () => {
    const missing = findMissingLocaleKeys(hostEn, hostLocales)
    if (missing.length > 0) {
      expect(
        missing,
        `Found ${missing.length} missing extension host translation(s):\n${formatLocaleReport(missing)}`,
      ).toEqual([])
    }
    expect(missing).toEqual([])
  })
})
