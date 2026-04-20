import { EXTENSION_DISPLAY_NAME } from "../constants"

const MAX = 50

export function panelTitle(title?: string): string {
  if (!title || /^(New|Child) session - \d{4}-/.test(title)) return EXTENSION_DISPLAY_NAME
  if (title.length <= MAX) return title
  return title.substring(0, MAX - 1) + "…"
}
