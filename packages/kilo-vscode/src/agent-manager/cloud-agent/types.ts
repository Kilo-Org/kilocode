export type CloudAgentToken = {
  token: string
  expiresAt: string
  kiloFacadeUrl: string
  cloudAgentUrl: string
}

export type CloudAgentSessionSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type CloudAgentListState = {
  repository?: string
} & (
  | { status: "loading"; sessions: CloudAgentSessionSummary[] }
  | { status: "ready"; sessions: CloudAgentSessionSummary[] }
  | { status: "error"; sessions: CloudAgentSessionSummary[]; error: string }
  | { status: "signed-out"; sessions: CloudAgentSessionSummary[] }
)
