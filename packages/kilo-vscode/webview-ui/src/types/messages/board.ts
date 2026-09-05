import type { SessionBoard } from "@kilocode/sdk/v2/client"

export type { SessionBoard } from "@kilocode/sdk/v2/client"

export interface RequestSessionBoardMessage {
  type: "requestSessionBoard"
  sessionID: string
  requestID: string
  projectId?: string
  before?: string
  limit?: number
}

export interface ResetSessionBoardMessage {
  type: "resetSessionBoard"
  sessionID: string
  requestID: string
  projectId?: string
  revision: number
}

export interface SessionBoardLoadedMessage {
  type: "sessionBoardLoaded"
  sessionID: string
  requestID: string
  projectId?: string
  board?: SessionBoard
  error?: string
}
