import type { MigrationSessionInfo } from "../../types/messages"

export interface SessionSummaryItem {
  id: string
  title: string
  directory: string
  time: number
  error?: string
}

export interface SessionSummaryState {
  imported: SessionSummaryItem[]
  skipped: SessionSummaryItem[]
  errored: SessionSummaryItem[]
  lastError?: string
}

export function createSessionItem(session: MigrationSessionInfo, error?: string): SessionSummaryItem {
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    time: session.time,
    error,
  }
}

export function createSessionSummary(): SessionSummaryState {
  return {
    imported: [],
    skipped: [],
    errored: [],
  }
}

export function updateSessionSummary(state: SessionSummaryState, item: SessionSummaryItem, phase: string): SessionSummaryState {
  if (phase === "skipped") {
    return {
      ...state,
      skipped: [...state.skipped.filter((entry) => entry.id !== item.id), item],
    }
  }

  if (phase === "error") {
    return {
      ...state,
      errored: [...state.errored.filter((entry) => entry.id !== item.id), item],
      lastError: item.error,
    }
  }

  if (phase === "done") {
    const seen = state.skipped.some((entry) => entry.id === item.id) || state.errored.some((entry) => entry.id === item.id)
    if (seen) return state
    return {
      ...state,
      imported: [...state.imported.filter((entry) => entry.id !== item.id), item],
    }
  }

  return state
}
