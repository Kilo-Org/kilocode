import type { Accessor } from "solid-js"
import type { MigrationResultItem } from "../../types/messages"
import { getSessionMigrationError, getSessionMigrationErrorDetail } from "./errors/error-selectors"

export interface ProgressEntry {
  item: string
  group: string
  status: "pending" | "migrating" | "success" | "warning" | "error"
  message?: string
}

export function getGroupStatus(entries: ProgressEntry[], group: string): ProgressEntry["status"] {
  const list = entries.filter((entry) => entry.group === group)
  if (list.length === 0) return "pending"
  if (list.some((entry) => entry.status === "error")) return "error"
  if (list.some((entry) => entry.status === "warning")) return "warning"
  if (list.every((entry) => entry.status === "success")) return "success"
  if (list.some((entry) => entry.status === "migrating")) return "migrating"
  return "pending"
}

export function getGroupMessage(entries: ProgressEntry[], group: string) {
  return entries.find((entry) => entry.group === group && entry.status === "error")?.message
}

export function getSuccessCount(results: MigrationResultItem[]) {
  return results.filter((result) => result.status === "success").length
}

export function getTotalCount(results: MigrationResultItem[]) {
  return results.length
}

export function getCurrentSessionError(
  results: Accessor<MigrationResultItem[]>,
  entries: Accessor<ProgressEntry[]>,
) {
  return getSessionMigrationError(results, (group) => getGroupMessage(entries(), group))
}

export function getCurrentSessionErrorDetail(
  results: Accessor<MigrationResultItem[]>,
  entries: Accessor<ProgressEntry[]>,
) {
  return getSessionMigrationErrorDetail(results, (group) => getGroupMessage(entries(), group))
}
