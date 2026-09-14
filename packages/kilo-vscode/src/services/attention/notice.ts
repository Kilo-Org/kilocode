import { t } from "../i18n"
import type { AttentionNotice } from "./service"

/**
 * The notification message followed by its context labels, localized. Shared so
 * the native toast and the workbench notification stay in the same field order
 * and use the same wording; only the separator differs.
 */
export function lines(notice: AttentionNotice): string[] {
  return [
    notice.message,
    notice.workspace ? `${t("kilocode:attention.workspace")}: ${notice.workspace}` : undefined,
    notice.session ? `${t("kilocode:attention.session")}: ${notice.session}` : undefined,
  ].filter((line): line is string => line !== undefined)
}
