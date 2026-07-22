import type {
  IndexingConfigInput,
  IndexingProfileRecord,
  IndexingTelemetryEvent,
  VectorStoreSearchResult,
} from "@kilocode/kilo-indexing/engine"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import type { IndexingWarning } from "./indexing-warning"

export type InitInput = {
  directory: string
  root: string
  config: IndexingConfigInput
  baselineDirectory?: string
  lancedbPath?: string
}

export type Request =
  | { type: "request"; id: number; key: string; method: "init"; input: InitInput }
  | {
      type: "request"
      id: number
      key: string
      method: "search"
      input: { query: string; directoryPrefix?: string }
    }
  | { type: "request"; id: number; key: string; method: "dispose"; input: undefined }

export type Result =
  | { type: "result"; id: number; method: "init"; ok: true; value: IndexingStatus }
  | { type: "result"; id: number; method: "search"; ok: true; value: VectorStoreSearchResult[] }
  | { type: "result"; id: number; method: "dispose"; ok: true; value: undefined }
  | { type: "result"; id: number; method: Request["method"]; ok: false; error: string }

export type Log = {
  level: "debug" | "info" | "warn" | "error"
  message: string
  profile?: IndexingProfileRecord
}

export type Event =
  | { type: "event"; key?: string; event: "status"; data: IndexingStatus }
  | { type: "event"; key?: string; event: "telemetry"; data: IndexingTelemetryEvent }
  | { type: "event"; key?: string; event: "warning"; data: IndexingWarning }
  | { type: "event"; key?: string; event: "log"; data: Log }

export type Message = Result | Event
