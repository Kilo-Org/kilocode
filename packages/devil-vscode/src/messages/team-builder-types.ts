/**
 * Team Builder message contracts for the Agent Manager extension ↔ webview boundary.
 *
 * SINGLE SOURCE OF TRUTH for team builder message types.
 * Extension imports from this file.
 * Webview copy lives at: webview-ui/src/types/team-builder-messages.ts
 *
 * This file has no external imports so it is safe to copy verbatim to the webview side.
 */

// ---------------------------------------------------------------------------
// Extension → Webview (outbound) message types
// ---------------------------------------------------------------------------

export interface TeamBuilderTeamLoadedOut {
  type: "teamBuilder.teamLoaded"
  teamId: string
  config: unknown
}

export interface TeamBuilderTeamsListOut {
  type: "teamBuilder.teamsList"
  teams: Array<{ id: string; name: string; path: string; updatedAt: string; isQuickstart: boolean }>
}

export interface TeamBuilderAggregationsOut {
  type: "teamBuilder.aggregations"
  data: unknown
}

export interface TeamBuilderSavedOut {
  type: "teamBuilder.saved"
  teamId: string
  success: boolean
  error?: string
}

export interface TeamBuilderDeletedOut {
  type: "teamBuilder.deleted"
  teamId: string
}

export interface TeamBuilderErrorOut {
  type: "teamBuilder.error"
  code: "LOAD_FAILED" | "SAVE_FAILED" | "DELETE_FAILED" | "AGGREGATION_FAILED" | "LIST_FAILED"
  teamId?: string
  message: string
}

// ---------------------------------------------------------------------------
// Webview → Extension (inbound) message types
// ---------------------------------------------------------------------------

export interface TeamBuilderLoadTeamIn {
  type: "teamBuilder.loadTeam"
  teamId: string
}

export interface TeamBuilderListTeamsIn {
  type: "teamBuilder.listTeams"
}

export interface TeamBuilderSaveTeamIn {
  type: "teamBuilder.saveTeam"
  teamId: string
  config: unknown
}

export interface TeamBuilderDeleteTeamIn {
  type: "teamBuilder.deleteTeam"
  teamId: string
}

export interface TeamBuilderGetAggregationsIn {
  type: "teamBuilder.getAggregations"
}

// Phase 10 — Live Team Editing: position swap message types
export interface TeamBuilderSwapIn {
  type: "teamBuilder.swapPosition"
  position: string
  provider: string
  model: string
}

export interface TeamBuilderSwappedOut {
  type: "teamBuilder.swapped"
  position: string
  success: boolean
  previousProvider?: string
  previousModel?: string
  newProvider?: string
  newModel?: string
  error?: string
}

export type TeamBuilderInMessage =
  | TeamBuilderLoadTeamIn
  | TeamBuilderListTeamsIn
  | TeamBuilderSaveTeamIn
  | TeamBuilderDeleteTeamIn
  | TeamBuilderGetAggregationsIn
  | TeamBuilderSwapIn

export type TeamBuilderOutMessage =
  | TeamBuilderTeamLoadedOut
  | TeamBuilderTeamsListOut
  | TeamBuilderAggregationsOut
  | TeamBuilderSavedOut
  | TeamBuilderDeletedOut
  | TeamBuilderErrorOut
  | TeamBuilderSwappedOut
