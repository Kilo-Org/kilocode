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
  teams: Array<{ id: string; name: string; isQuickstart: boolean }>
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

export type TeamBuilderInMessage =
  | TeamBuilderLoadTeamIn
  | TeamBuilderListTeamsIn
  | TeamBuilderSaveTeamIn
  | TeamBuilderDeleteTeamIn
  | TeamBuilderGetAggregationsIn

export type TeamBuilderOutMessage =
  | TeamBuilderTeamLoadedOut
  | TeamBuilderTeamsListOut
  | TeamBuilderAggregationsOut
  | TeamBuilderSavedOut
  | TeamBuilderErrorOut
