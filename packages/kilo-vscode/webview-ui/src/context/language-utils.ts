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
]

/**
 * Normalize a BCP 47 language tag to one of the supported Locale values.
 * Falls back to "en" for unrecognized locales.
 */
export function normalizeLocale(lang: string): Locale {
  const lower = lang.toLowerCase()
  if (lower.startsWith("zh")) {
    return lower.includes("hant") ? "zht" : "zh"
  }
  for (const loc of LOCALES) {
    if (lower.startsWith(loc)) {
      return loc
    }
  }
  if (lower.startsWith("nb") || lower.startsWith("nn")) {
    return "no"
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
