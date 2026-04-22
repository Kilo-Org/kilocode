import type { LanguageContextValue } from "../../context/language"

function pad(value: number) {
  return String(value).padStart(2, "0")
}

export function formatDate(language: LanguageContextValue, time: number) {
  if (!time) return language.t("migration.sessionFormat.unknownDate")
  const value = new Date(time)
  return `${pad(value.getHours())}:${pad(value.getMinutes())} ${pad(value.getMonth() + 1)}/${pad(value.getDate())}/${value.getFullYear()}`
}

export function formatPath(language: LanguageContextValue, value: string) {
  const text = value.trim()
  if (!text) return language.t("migration.sessionFormat.unknown")
  const parts = text.split(/[\\/]/).filter(Boolean)
  const last = parts.at(-1)
  if (!last) return text
  return `.../${last}`
}

export function formatText(language: LanguageContextValue, value: string) {
  const text = value.trim()
  return text || language.t("migration.sessionFormat.unknown")
}

export function formatError(language: LanguageContextValue, value?: string) {
  if (!value) return language.t("migration.sessionFormat.unknownError")
  return value.split("\n")[0]?.trim() || value
}
