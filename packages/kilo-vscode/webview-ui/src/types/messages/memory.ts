import type {
  MemoryCorrectResponse,
  MemoryConfigureResponse,
  MemoryDisableResponse,
  MemoryEnableResponse,
  MemoryForgetResponse,
  MemoryPurgeResponse,
  MemoryRememberResponse,
  MemoryRebuildResponse,
  MemoryShowResponse,
  MemoryStatusResponse,
} from "@kilocode/sdk/v2"
import type {
  MemoryOperation as SharedMemoryOperation,
  MemoryPromptOperation as SharedMemoryPromptOperation,
} from "@kilocode/kilo-memory/commands"
import type { MemorySchema } from "@kilocode/kilo-memory/schema"

export type MemorySourceFile = MemorySchema.Source

export type MemoryOperation = SharedMemoryOperation

export type MemoryResultOperation = MemoryOperation

export type MemoryPromptOperation = SharedMemoryPromptOperation

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
  show?: MemoryShowResponse
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
  show?: MemoryShowResponse
  result?: MemoryOperationResponse
  error?: string
}

export interface RequestMemoryMessage {
  type: "requestMemory"
  sessionID?: string
  includeSources?: boolean
}

export interface MemoryShowMessage {
  type: "memoryShow"
  sessionID?: string
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

export interface MemoryPromptMessage {
  type: "memoryPrompt"
  operation: MemoryPromptOperation
  sessionID?: string
}
