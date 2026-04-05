import type { SessionSummaryItem, SessionSummaryState } from "./session-migration-summary-state"
import type { LanguageContextValue } from "../../context/language"
import { formatDate, formatError, formatPath, formatText } from "./session-migration-format"

export function line(language: LanguageContextValue, item: SessionSummaryItem) {
  const dir = formatPath(language, item.directory)
  const title = formatText(language, item.title)
  return `${dir} ${title} ${formatDate(language, item.time)}`
}

export function short(language: LanguageContextValue, error?: string) {
  return formatError(language, error)
}

export function detail(language: LanguageContextValue, item: SessionSummaryItem) {
  return short(language, item.error)
}

export function errored(language: LanguageContextValue, summary: SessionSummaryState) {
  if (summary.errored.length === 0) return [{ kind: "row", text: language.t("migration.sessionSummary.none") }]
  return summary.errored.flatMap((item) => [
    { kind: "row", text: line(language, item) },
    { kind: "detail", text: detail(language, item) },
  ])
}

export function report(language: LanguageContextValue, summary: SessionSummaryState) {
  const block = (title: string, items: SessionSummaryItem[], full?: boolean) => {
    const rows =
      items.length > 0
        ? items
            .map((item) => (full ? `${line(language, item)}\n  ${short(language, item.error)}` : line(language, item)))
            .join("\n")
        : language.t("migration.sessionSummary.none")
    return `${title}\n${rows}`
  }

  return [
    language.t("migration.sessionSummary.title"),
    "",
    block(language.t("migration.sessionSummary.successful"), summary.imported),
    "",
    block(language.t("migration.sessionSummary.skipped"), summary.skipped),
    "",
    block(language.t("migration.sessionSummary.errored"), summary.errored, true),
  ]
    .filter(Boolean)
    .join("\n")
}
