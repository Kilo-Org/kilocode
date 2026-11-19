import { dict } from "@kilocode/kilo-i18n/en"

export type BrowserCopyKey = keyof typeof dict

/** One Kilo browser string, with its `{{name}}` placeholders filled. */
export function browserCopy(key: BrowserCopyKey, params: Record<string, string> = {}) {
  return Object.entries(params).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    dict[key] ?? key,
  )
}
