// kilocode_change - new file
// Types for AST relationship extraction

import type { GraphNode, GraphEdge, GraphNodeKind, ImportInfo } from "../graph/types"

export interface ExtractedRelationships {
  nodes: GraphNode[]
  edges: Omit<GraphEdge, "id">[]
  imports: ImportInfo[]
  symbols: Array<{
    name: string
    nodeId: string
    filePath: string
    kind: GraphNodeKind
    scopeId?: string
    isExported: boolean
  }>
}

export interface ReferenceCapture {
  name: string
  kind: "call" | "import" | "type_ref" | "member_access" | "instantiation" | "extends" | "implements"
  line: number
  column: number
  objectName?: string
  sourcePath?: string
}

export interface Scope {
  id: string
  kind: "file" | "class" | "function" | "module" | "namespace"
  name: string
  parent?: Scope
}
