export namespace MemoryAutosaveStatus {
  export type Stats = {
    lastTypedConsolidationAt: number | null | undefined
    lastSessionSavedAt: number | null | undefined
    lastOperationCount: number
  }

  export type Summary =
    | { state: "off"; count: 0; at: undefined }
    | { state: "watching"; count: 0; at: undefined }
    | { state: "saved"; count: number; at: number }
    | { state: "handoff"; count: 0; at: number }
    | { state: "idle"; count: 0; at: number }

  export function summarize(input: { autoConsolidate: boolean; stats: Stats }): Summary {
    if (!input.autoConsolidate) return { state: "off", count: 0, at: undefined }
    const at = input.stats.lastTypedConsolidationAt
    const session = input.stats.lastSessionSavedAt
    if (!at) {
      if (session) return { state: "handoff", count: 0, at: session }
      return { state: "watching", count: 0, at: undefined }
    }
    const count = input.stats.lastOperationCount
    if (count > 0) return { state: "saved", count, at }
    if (session && session >= at) return { state: "handoff", count: 0, at: session }
    return { state: "idle", count: 0, at }
  }
}
