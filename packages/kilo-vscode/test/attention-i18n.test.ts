import { afterEach, describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import { dict as en } from "@kilocode/kilo-i18n/en"
import { t } from "../src/attention/i18n"

const dir = path.resolve(import.meta.dir, "../../kilo-i18n/src")
const keys = Object.keys(en).filter((key) => key.startsWith("attention."))
const workspace = vscode.workspace as unknown as { getConfiguration: typeof vscode.workspace.getConfiguration }
const original = workspace.getConfiguration

afterEach(() => {
  workspace.getConfiguration = original
})

function language(value: string) {
  workspace.getConfiguration = (() => ({ get: () => value })) as unknown as typeof vscode.workspace.getConfiguration
}

describe("attention copy", () => {
  test.each(readdirSync(dir).filter((file) => file !== "en.ts"))("%s translates every attention string", async (file) => {
    const locale = ((await import(path.join(dir, file))) as { dict: Record<string, string> }).dict
    for (const key of keys) {
      expect(locale[key], `${file} ${key}`).toBeString()
      expect(locale[key], `${file} ${key}`).not.toBe("")
    }
    // Only the product name stays English; every sentence is translated.
    expect(locale["attention.done"]).not.toBe(en["attention.done"])
  })

  test("follows the Kilo language setting", () => {
    language("de")
    expect(t("attention.done")).toBe("Kilo hat die Aufgabe abgeschlossen.")
    language("zh-TW")
    expect(t("attention.show")).toBe("檢視")
  })

  test("falls back to English for a language without a Kilo dictionary", () => {
    language("fa")
    expect(t("attention.permission")).toBe("Kilo needs permission.")
  })
})
