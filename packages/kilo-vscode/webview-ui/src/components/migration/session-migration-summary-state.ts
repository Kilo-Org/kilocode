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

function strip(state: SessionSummaryState, id: string) {
  return {
    imported: state.imported.filter((entry) => entry.id !== id),
    skipped: state.skipped.filter((entry) => entry.id !== id),
    errored: state.errored.filter((entry) => entry.id !== id),
  }
}

export function updateSessionSummary(
  state: SessionSummaryState,
  item: SessionSummaryItem,
  phase: string,
): SessionSummaryState {
  if (phase === "skipped") {
    const next = strip(state, item.id)
    return {
      ...state,
      ...next,
      skipped: [...next.skipped, item],
    }
  }

  if (phase === "error") {
    const next = strip(state, item.id)
    return {
      ...state,
      ...next,
      errored: [...next.errored, item],
    }
  }

  if (phase === "done") {
    const next = strip(state, item.id)
    return {
      ...state,
      ...next,
      imported: [...next.imported, item],
    }
  }

  return state
}
