export type PermissionLevel = "allow" | "ask" | "deny"

/** null in a PermissionRule object is a delete sentinel — removes the key from the config */
export type PermissionRule = PermissionLevel | Record<string, PermissionLevel | null>

export type PermissionConfig = Partial<Record<string, PermissionRule>>

// A single resolved permission rule from the CLI backend (matches PermissionNext.Rule)
export interface PermissionRuleItem {
  permission: string
  pattern: string
  action: PermissionLevel
}

// Permission request
export interface PermissionFileDiff {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
}

export interface PermissionRequest {
  id: string
  sessionID: string
  toolName: string
  patterns: string[]
  always: string[]
  args: Record<string, unknown> & {
    rules?: string[]
    diff?: string
    filepath?: string
    filediff?: PermissionFileDiff
  }
  message?: string
  tool?: { messageID: string; callID: string }
}
