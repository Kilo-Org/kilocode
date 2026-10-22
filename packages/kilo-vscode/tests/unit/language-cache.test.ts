import { describe, expect, it } from "bun:test"
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"
import type { UiI18nParams, UiI18nPluralKey, UiPluralCategory } from "@kilocode/kilo-ui/context/i18n"
import type { LanguageContextValue, LanguageProvider } from "../../webview-ui/src/context/language"
import {
  LOCALES,
  RTL_LOCALES,
  localeToBcp47,
  normalizeLocale,
  resolveTemplate,
  type Locale,
} from "../../webview-ui/src/context/language-utils"

const file = path.resolve(import.meta.dir, "../../webview-ui/src/context/language.tsx")
const project = new Project({ useInMemoryFileSystem: true })
const source = project.createSourceFile("language.tsx", await Bun.file(file).text())
const folder = path.join(path.dirname(file), "language-dictionaries")
const dictionaries = await Promise.all(
  [...new Bun.Glob("**/*.ts").scanSync({ cwd: folder })].map(async (name) =>
    project.createSourceFile(name, await Bun.file(path.join(folder, name)).text()),
  ),
)
const imports = source
  .getImportDeclarations()
  .filter((item) => item.getNamedImports().some((name) => name.getName() === "dict"))
const layers: Record<string, Record<string, string>> = Object.fromEntries(
  await Promise.all(
    imports.map(async (item) => {
      const name = item.getNamedImports().at(0)?.getAliasNode()?.getText()
      if (!name) throw new Error("Missing dictionary alias")
      const specifier = item.getModuleSpecifierValue()
      const target = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier
      return [name, (await import(target)).dict]
    }),
  ),
)
const solid: typeof import("solid-js") = await import(path.join(path.dirname(require.resolve("solid-js")), "solid.js"))
// The UI i18n module is JSX, so extract the real plural helpers instead of importing it.
const uiI18n = project.createSourceFile(
  "ui-i18n.tsx",
  await Bun.file(path.resolve(import.meta.dir, "../../../ui/src/context/i18n.tsx")).text(),
)
const helpers = new Function(
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(
    [
      uiI18n.getVariableStatementOrThrow("rules").getText(),
      uiI18n
        .getFunctionOrThrow("pluralCategory")
        .getText()
        .replace(/^export /, ""),
      uiI18n
        .getFunctionOrThrow("pluralKey")
        .getText()
        .replace(/^export /, ""),
    ].join("\n"),
  )}; return { pluralCategory, pluralKey }`,
)() as {
  pluralCategory: (locale: string, count: number) => UiPluralCategory
  pluralKey: (key: UiI18nPluralKey, category: UiPluralCategory) => string
}
const { pluralCategory, pluralKey } = helpers
const body = source
  .getVariableDeclarationOrThrow("LanguageProvider")
  .getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction)
  .getBody()
  .asKindOrThrow(SyntaxKind.Block)

// Execute the actual cache and provider setup without compiling JSX or loading the renderer graph.
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(`
  ${["base", "english", "cache", "loads"].map((name) => source.getVariableStatementOrThrow(name).getText()).join("\n")}
  ${source.getFunctionOrThrow("load").getText().replace("import(`./language-dictionaries/${locale}.ts`)", "importer(locale)")}
  ${["normalizeLocale", "resolveTemplate"].map((name) => source.getFunctionOrThrow(name).getText()).join("\n")}
  function provider(props) {
    ${body
      .getStatements()
      .filter((item) => !item.isKind(SyntaxKind.ReturnStatement))
      .map((item) => item.getText())
      .join("\n")}
    return { locale, setLocale, userOverride, t, plural }
  }
`)
const setup = new Function(
  ...Object.keys(layers),
  "deps",
  `const { createSignal, createMemo, createEffect, onCleanup, useVSCode, document, navigator, importer, console,
    _normalizeLocale, _resolveTemplate, RTL_LOCALES, localeToBcp47, pluralKey, pluralCategory } = deps;
    ${code}; return { cache, load, provider }`,
)

function scene() {
  const html = { lang: "", dir: "" }
  const sent: unknown[] = []
  const errors: unknown[][] = []
  type Dictionary = typeof import("../../webview-ui/src/context/language-dictionaries/it")
  const requests: (ReturnType<typeof Promise.withResolvers<Dictionary>> & { locale: Exclude<Locale, "en"> })[] = []
  const state = setup(...Object.values(layers), {
    ...solid,
    useVSCode: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: { documentElement: html },
    navigator: { language: "fr-FR" },
    importer: (locale: Exclude<Locale, "en">) => {
      const request = { ...Promise.withResolvers<Dictionary>(), locale }
      requests.push(request)
      return request.promise
    },
    console: { error: (...args: unknown[]) => errors.push(args) },
    _normalizeLocale: normalizeLocale,
    _resolveTemplate: resolveTemplate,
    RTL_LOCALES,
    localeToBcp47,
    pluralKey,
    pluralCategory,
  }) as {
    cache: Partial<Record<Locale, Record<string, string>>>
    load: (locale: Locale) => Promise<Record<string, string> | undefined>
    provider: (props: Parameters<typeof LanguageProvider>[0]) => LanguageContextValue & {
      plural: (key: UiI18nPluralKey, count: number, params?: UiI18nParams) => string
    }
  }
  return {
    ...state,
    html,
    sent,
    errors,
    requests,
    ready: async (locale = requests.at(-1)!.locale) => {
      const request = requests.findLast((item) => item.locale === locale)!
      request.resolve(await import(path.join(folder, `${locale}.ts`)))
    },
  }
}

describe("language dictionary cache", () => {

  it("ignores an obsolete non-English request after switching back to English", async () => {
    const state = scene()
    const root = solid.createRoot((dispose) => ({ ...state.provider({ vscodeLanguage: () => "en" }), dispose }))
    try {
      root.setLocale("ar")
      root.setLocale("en")
      await state.ready()
      await state.load("ar")
      expect(root.locale()).toBe("en")
      expect(root.t("settings.language.title")).toBe(layers.appEn!["settings.language.title"])
      expect(state.html).toEqual({ lang: "en", dir: "ltr" })
      root.setLocale("ar")
      expect(root.locale()).toBe("ar")
      expect(state.html).toEqual({ lang: "ar", dir: "rtl" })
    } finally {
      root.dispose()
    }
  })

  it("ignores disposed callbacks while another provider shares the same pending load", async () => {
    const state = scene()
    const first = solid.createRoot((dispose) => ({ ...state.provider({ vscodeLanguage: () => "en" }), dispose }))
    const second = solid.createRoot((dispose) => ({ ...state.provider({ vscodeLanguage: () => "en" }), dispose }))
    first.setLocale("ar")
    second.setLocale("ar")
    first.dispose()
    try {
      expect(state.requests).toHaveLength(1)
      await state.ready()
      await state.load("ar")
      expect(first.locale()).toBe("en")
      expect(second.locale()).toBe("ar")
      expect(state.html).toEqual({ lang: "ar", dir: "rtl" })
    } finally {
      second.dispose()
    }
  })

  it("keeps displayed locale, direction, plurals, and overrides coherent with English fallback", async () => {
    const state = scene()
    const [language, change] = solid.createSignal<string | undefined>("de-DE")
    const [override, update] = solid.createSignal<string | undefined>("zh-Hant")
    const root = solid.createRoot((dispose) => ({
      ...state.provider({ vscodeLanguage: language, languageOverride: override }),
      dispose,
    }))
    try {
      expect(root.locale()).toBe("en")
      expect(root.userOverride()).toBe("zht")
      expect(state.html).toEqual({ lang: "en", dir: "ltr" })
      await state.ready()
      await state.load("zht")
      expect(root.locale()).toBe("zht")
      expect(state.html).toEqual({ lang: "zh-TW", dir: "ltr" })
      for (const locale of ["ar", "fa", "br", "en"] as const) {
        const previous = root.locale()
        const text = root.t("settings.language.title")
        root.setLocale(locale)
        if (!state.cache[locale]) {
          expect(root.locale()).toBe(previous)
          expect(root.t("settings.language.title")).toBe(text)
          expect(state.html).toEqual({ lang: localeToBcp47(previous), dir: RTL_LOCALES.has(previous) ? "rtl" : "ltr" })
          await state.ready(locale)
        }
        await state.load(locale)
        expect(root.locale()).toBe(locale)
        expect(root.userOverride()).toBe(locale)
        expect(root.t("settings.language.title")).toBe(state.cache[locale]!["settings.language.title"])
        expect(state.html).toEqual({ lang: localeToBcp47(locale), dir: RTL_LOCALES.has(locale) ? "rtl" : "ltr" })
        for (const count of [0, 1, 2, 3, 11, 100]) {
          const key = pluralKey("ui.sessionTurn.diffs.changed", pluralCategory(localeToBcp47(locale), count))
          expect(root.plural("ui.sessionTurn.diffs.changed", count, { count: 99 })).toBe(root.t(key, { count }))
        }
      }
      root.setLocale("")
      await state.ready("de")
      await state.load("de")
      expect(root.locale()).toBe("de")
      delete state.cache.de!["common.save"]
      expect(root.t("common.save")).toBe(state.cache.en!["common.save"])
      expect(root.t("missing.key")).toBe("missing.key")
      state.cache.de!["common.save"] = ""
      expect(root.t("common.save")).toBe("")
      change(undefined)
      expect(root.locale()).toBe("de")
      await state.ready("fr")
      await state.load("fr")
      expect(root.locale()).toBe("fr")
      update("fa-IR")
      expect(root.locale()).toBe("fa")
      expect(state.html.dir).toBe("rtl")
      update("")
      expect(root.locale()).toBe("fa")
      expect(state.sent).toEqual(["ar", "fa", "br", "en", ""].map((locale) => ({ type: "setLanguage", locale })))
    } finally {
      root.dispose()
    }
  })

  it("isolates load rejection and retries when the same language is selected again", async () => {
    const state = scene()
    const root = solid.createRoot((dispose) => ({ ...state.provider({ vscodeLanguage: () => "en" }), dispose }))
    try {
      root.setLocale("ar")
      const pending = state.load("ar")
      const request = state.requests.at(-1)!
      const persian = state.load("fa")
      const err = new Error("Dictionary chunk unavailable")
      request.reject(err)
      expect(await pending).toBeUndefined()
      expect(state.load("fa")).toBe(persian)
      expect(state.errors).toEqual([["[Kilo New] Failed to load language", { locale: "ar", err }]])
      expect(root.locale()).toBe("en")
      expect(root.t("common.save")).toBe(state.cache.en!["common.save"])
      expect(state.html).toEqual({ lang: "en", dir: "ltr" })
      root.setLocale("ar")
      expect(state.requests.map((item) => item.locale)).toEqual(["ar", "fa", "ar"])
      await state.ready("ar")
      await state.load("ar")
      expect(root.locale()).toBe("ar")
      expect(state.html).toEqual({ lang: "ar", dir: "rtl" })
      expect(root.t("common.save")).toBe(state.cache.ar!["common.save"])
      await state.ready("fa")
      expect(await persian).toBe(state.cache.fa)
      expect(root.locale()).toBe("ar")
    } finally {
      root.dispose()
    }
  })
})
