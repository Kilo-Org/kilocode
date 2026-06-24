// kilocode_change - new file
// Native graph indexing types for codebase intelligence

export type GraphNodeKind =
  | "file"
  | "module"
  | "class"
  | "interface"
  | "enum"
  | "function"
  | "method"
  | "constructor"
  | "property"
  | "field"
  | "variable"
  | "constant"
  | "type_alias"
  | "import"
  | "export"
  | "namespace"
  | "trait"
  | "struct"
  | "macro"
  | "component"

export type GraphEdgeKind =
  | "contains"
  | "calls"
  | "imports"
  | "exports"
  | "extends"
  | "implements"
  | "references"
  | "typed_by"
  | "returns"
  | "parameter"
  | "instantiates"
  | "accesses"
  | "overrides"
  | "includes"

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  name: string
  filePath: string
  startLine: number
  endLine: number
  signature?: string
  language?: string
  parentId?: string
  metadata?: Record<string, unknown>
}

export interface GraphEdge {
  id: number
  from: string
  to: string
  kind: GraphEdgeKind
  filePath: string
  line: number
  column?: number
}

export interface GraphSearchResult {
  node: GraphNode
  score: number
  vectorScore?: number
  graphScore?: number
  callers: GraphNode[]
  callees: GraphNode[]
  related: GraphNode[]
}

export interface DependencyChain {
  filePath: string
  imports: string[]
  importedBy: string[]
  depth: number
}
