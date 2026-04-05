// i18n bridge for autocomplete module
// Provides a t() function using the autocomplete English dictionary as fallback.
// Can be wired to locale detection later.

import { dict as enDict } from "../i18n/en"

const translations: Record<string, string> = { ...enDict }

export function t(key: string, vars?: Record<string, string | number>): string {
  let text = translations[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return text
}
