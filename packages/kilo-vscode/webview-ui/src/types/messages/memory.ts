import type {
  MemoryCorrectResponse,
  MemoryConfigureResponse,
  MemoryDisableResponse,
  MemoryEnableResponse,
  MemoryForgetResponse,
  MemoryPurgeResponse,
  MemoryRememberResponse,
  MemoryRebuildResponse,
  MemoryStatusResponse,
} from "@kilocode/sdk/v2"
import type { MemoryOperation as SharedMemoryOperation } from "@kilocode/kilo-memory/commands"
import type { MemorySchema } from "@kilocode/kilo-memory/schema"

export type MemorySourceFile = MemorySchema.Source

export type MemoryOperation = SharedMemoryOperation

export type MemoryResultOperation = MemoryOperation

export type MemoryOperationResponse =
  | MemoryEnableResponse
  | MemoryConfigureResponse
  | MemoryDisableResponse
  | MemoryStatusResponse
  | MemoryRebuildResponse
  | MemoryRememberResponse
  | MemoryCorrectResponse
  | MemoryForgetResponse
  | MemoryPurgeResponse

export interface MemoryLoadedMessage {
  type: "memoryLoaded"
  sessionID?: string
  status?: MemoryStatusResponse
  error?: string
}

export interface MemoryEventDetail {
  type?: "saved" | "skipped" | "recalled" | "error"
  message?: string
  reason?: string
  duplicateOf?: string
  tokens?: number
  operationCount?: number
  added?: number
  removed?: number
  skippedCount?: number
  sources?: string[]
  files?: string[]
}

export interface MemoryEventMessage {
  type: "memoryEvent"
  sessionID?: string
  detail: MemoryEventDetail
}

export interface MemoryOperationResultMessage {
  type: "memoryOperationResult"
  operation: MemoryResultOperation
  sessionID?: string
  ok: boolean
  status?: MemoryStatusResponse
  result?: MemoryOperationResponse
  error?: string
}

export interface RequestMemoryMessage {
  type: "requestMemory"
  sessionID?: string
}

export interface MemoryShowMessage {
  type: "memoryShow"
  sessionID?: string
  mode?: "status" | "show"
}

export interface MemoryOperationMessage {
  type: "memoryOperation"
  operation: MemoryOperation
  sessionID?: string
  mode?: "status" | "on" | "off"
  confirm?: boolean
  text?: string
  query?: string
  key?: string
  file?: MemorySourceFile
  section?: string
}
