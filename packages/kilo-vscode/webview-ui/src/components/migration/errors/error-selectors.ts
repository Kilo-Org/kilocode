import type { Accessor } from "solid-js"
import type { MigrationResultItem } from "../../../types/messages"

export function getMigrationError(err?: string) {
  if (!err) return undefined
  const i = err.indexOf(":")
  if (i < 0) return err
  const text = err.slice(i + 1).trim()
  return text || err
}

export function getSessionMigrationError(
  results: Accessor<MigrationResultItem[]>,
  groupMessage: (group: string) => string | undefined,
) {
  return groupMessage("sessions")
}

export function getSessionMigrationErrorDetail(
  results: Accessor<MigrationResultItem[]>,
  groupMessage: (group: string) => string | undefined,
) {
  return getMigrationError(getSessionMigrationError(results, groupMessage))
}
