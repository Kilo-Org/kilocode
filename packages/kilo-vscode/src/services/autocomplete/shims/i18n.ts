import { t as shared } from "../../cli-backend/i18n"
import { dict as en } from "../i18n/en"

const translations: Record<string, string> = { ...en }

export function t(key: string, vars?: Record<string, string | number>): string {
  if (key === "kilocode:autocomplete.creditsExhausted.message" || key === "kilocode:autocomplete.authError.message") {
    return shared(key, vars)
  }

  let text = translations[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return text
}
