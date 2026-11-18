import { t } from "./i18n"

export type AttentionNotice = {
  message: string
  workspace?: string
  session?: string
}

/**
 * The notification message followed by its context labels, localized. The native toast and the VS Code notification
 * share it, so both keep the same field order and wording; only the separator differs.
 */
export function lines(notice: AttentionNotice): string[] {
  return [
    notice.message,
    notice.workspace ? `${t("attention.workspace")}: ${notice.workspace}` : undefined,
    notice.session ? `${t("attention.session")}: ${notice.session}` : undefined,
  ].filter((line): line is string => line !== undefined)
}
