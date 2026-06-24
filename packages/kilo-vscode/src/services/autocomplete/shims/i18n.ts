// i18n bridge for autocomplete module

import * as vscode from "vscode"
import { load } from "../i18n"

const translations = load(vscode.env.language)

export function t(key: string, vars?: Record<string, string | number>): string {
  let text = translations[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return text
}
