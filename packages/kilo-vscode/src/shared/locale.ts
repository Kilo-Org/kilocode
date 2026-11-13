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
  | "it"
  | "fa"

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
  "it",
  "fa",
]

/** Normalize a BCP 47 language tag to one of the supported locales, and fall back to `en`. */
export function normalizeLocale(lang: string): Locale {
  const lower = lang.toLowerCase()
  if (lower.startsWith("zh")) {
    if (lower === "zht") return "zht"
    const traditional = lower.includes("hant") || lower.includes("-tw") || lower.includes("-hk") || lower.includes("-mo")
    return traditional ? "zht" : "zh"
  }
  for (const loc of LOCALES) {
    if (lower.startsWith(loc)) return loc
  }
  if (lower.startsWith("nb") || lower.startsWith("nn")) return "no"
  if (lower.startsWith("pt")) return "br"
  return "en"
}
