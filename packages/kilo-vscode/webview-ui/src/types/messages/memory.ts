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

export type MemorySourceFile = "project.md" | "environment.md" | "corrections.md"

export type MemoryOperation = "enable" | "disable" | "rebuild" | "remember" | "correct" | "forget" | "purge" | "auto"

export type MemoryResultOperation = MemoryOperation

export type MemoryPromptOperation = "remember" | "forget"

export type MemoryOperationResponse =
  | MemoryEnableResponse
  | MemoryConfigureResponse
  | MemoryDisableResponse
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
  result?: MemoryStatusResponse | MemoryShowResponse | MemoryOperationResponse
  error?: string
}

export interface RequestMemoryMessage {
  type: "requestMemory"
  sessionID?: string
  includeSources?: boolean
}

export interface MemoryInspectMessage {
  type: "memoryInspect"
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
