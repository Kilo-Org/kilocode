// kilocode_change - new file
// Graph indexing module exports

export { GraphDatabase } from "./database"
export { GraphBuilder } from "./builder"
export { GraphSearch } from "./search"
export { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION } from "./schema"
export type {
  GraphNode,
  GraphEdge,
  GraphNodeKind,
  GraphEdgeKind,
  GraphSearchResult,
  SymbolReference,
  CallSite,
  ImportInfo,
  TypeHierarchy,
  DependencyChain,
} from "./types"
