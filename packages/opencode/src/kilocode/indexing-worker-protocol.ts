import type {
  IndexingConfigInput,
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

// kilocode_change - graph query types
export type GraphNodeResult = {
  id: string
  kind: string
  name: string
  filePath: string
  startLine: number
  endLine: number
  signature?: string
  language?: string
}

export type GraphSearchResult = {
  node: GraphNodeResult
  score: number
  callers: GraphNodeResult[]
  callees: GraphNodeResult[]
  related: GraphNodeResult[]
}

export type GraphHierarchyResult = {
  incoming: Array<{ node: GraphNodeResult; depth: number }>
  outgoing: Array<{ node: GraphNodeResult; depth: number }>
}

export type GraphDependencyResult = {
  filePath: string
  imports: string[]
  importedBy: string[]
  depth: number
}

export type GraphImpactResult = {
  depth: number
  node: GraphNodeResult
  relation: string
  confidence: number
}

export type GraphTraceResult = {
  path: GraphNodeResult[]
  pathLength: number
}

export type GraphContextResult = {
  definitions: GraphNodeResult[]
  callers: GraphNodeResult[]
  callees: GraphNodeResult[]
  subclasses: GraphNodeResult[]
  superclasses: GraphNodeResult[]
  imports: Array<{ sourcePath: string; importedNames: string[] }>
  importedBy: string[]
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
  // kilocode_change - graph query requests
  | { type: "request"; id: number; key: string; method: "graph_search"; input: { query: string; kinds?: string[]; limit?: number } }
  | { type: "request"; id: number; key: string; method: "graph_find_references"; input: { symbol: string; filePath?: string } }
  | { type: "request"; id: number; key: string; method: "graph_call_hierarchy"; input: { symbol: string; direction: string; maxDepth: number } }
  | { type: "request"; id: number; key: string; method: "graph_dependencies"; input: { filePath?: string; maxDepth: number } }
  | { type: "request"; id: number; key: string; method: "graph_impact"; input: { symbol: string; maxDepth: number } }
  | { type: "request"; id: number; key: string; method: "graph_trace"; input: { from: string; to: string } }
  | { type: "request"; id: number; key: string; method: "graph_context"; input: { symbol: string } }
  | { type: "request"; id: number; key: string; method: "graph_query"; input: { sql: string; params?: (string | number)[] } }

export type Result =
  | { type: "result"; id: number; method: "init"; ok: true; value: IndexingStatus }
  | { type: "result"; id: number; method: "search"; ok: true; value: VectorStoreSearchResult[] }
  | { type: "result"; id: number; method: "dispose"; ok: true; value: undefined }
  // kilocode_change - graph query results
  | { type: "result"; id: number; method: "graph_search"; ok: true; value: GraphSearchResult[] }
  | { type: "result"; id: number; method: "graph_find_references"; ok: true; value: { definitions: GraphNodeResult[]; references: GraphNodeResult[] } }
  | { type: "result"; id: number; method: "graph_call_hierarchy"; ok: true; value: GraphHierarchyResult }
  | { type: "result"; id: number; method: "graph_dependencies"; ok: true; value: { circular: string[][]; chain: GraphDependencyResult[] } }
  | { type: "result"; id: number; method: "graph_impact"; ok: true; value: GraphImpactResult[] }
  | { type: "result"; id: number; method: "graph_trace"; ok: true; value: GraphTraceResult }
  | { type: "result"; id: number; method: "graph_context"; ok: true; value: GraphContextResult }
  | { type: "result"; id: number; method: "graph_query"; ok: true; value: unknown[] }
  | { type: "result"; id: number; method: Request["method"]; ok: false; error: string }

export type Log = {
  level: "debug" | "info" | "warn" | "error"
  message: string
}

export type Event =
  | { type: "event"; key?: string; event: "status"; data: IndexingStatus }
  | { type: "event"; key?: string; event: "telemetry"; data: IndexingTelemetryEvent }
  | { type: "event"; key?: string; event: "warning"; data: IndexingWarning }
  | { type: "event"; key?: string; event: "log"; data: Log }

export type Message = Result | Event
