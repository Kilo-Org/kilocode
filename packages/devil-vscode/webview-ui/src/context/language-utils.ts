export type Locale =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "ar"
  | "no"
  | "br"
  | "th"
  | "bs"
  | "tr"
  | "nl"
  | "uk"

/** Locales that use right-to-left script. */
export const RTL_LOCALES = new Set<Locale>(["ar"])

/** Map internal locale IDs to valid BCP 47 language tags for the HTML lang attribute. */
export const LOCALE_BCP47: Partial<Record<Locale, string>> = {
  br: "pt-BR",
  zht: "zh-TW",
}

/** Return the BCP 47 language tag for a locale (falls back to the locale id itself). */
export function localeToBcp47(locale: Locale): string {
  return LOCALE_BCP47[locale] ?? locale
}

export const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "ar",
  "no",
  "br",
  "th",
  "bs",
  "tr",
  "nl",
  "uk",
]

/**
 * Normalize a BCP 47 language tag to one of the supported Locale values.
 * Falls back to "en" for unrecognized locales.
 */
export function normalizeLocale(lang: string): Locale {
  const lower = lang.toLowerCase()
  if (lower.startsWith("zh")) {
    if (lower === "zht") return "zht"
    const traditional =
      lower.includes("hant") || lower.includes("-tw") || lower.includes("-hk") || lower.includes("-mo")
    return traditional ? "zht" : "zh"
  }
  for (const loc of LOCALES) {
    if (lower.startsWith(loc)) {
      return loc
    }
  }
  if (lower.startsWith("nb") || lower.startsWith("nn")) {
    return "no"
  }
  if (lower.startsWith("nl")) {
    return "nl"
  }
  if (lower.startsWith("pt")) {
    return "br"
  }
  return "en"
}

/**
 * Perform {{key}} template interpolation against a params record.
 */
export function resolveTemplate(text: string, params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return text
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey) => {
    const value = params[String(rawKey)]
    return value === undefined ? "" : String(value)
  })
}
