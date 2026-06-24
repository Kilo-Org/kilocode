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
  | "contains"        // file contains function, class contains method
  | "calls"           // function calls function
  | "imports"         // file imports module/symbol
  | "exports"         // file exports symbol
  | "extends"         // class extends class
  | "implements"      // class implements interface
  | "references"      // variable references symbol
  | "typed_by"        // variable typed by type
  | "returns"         // function returns type
  | "parameter"       // function has parameter of type
  | "instantiates"    // new ClassName()
  | "accesses"        // accesses property/field
  | "overrides"       // method overrides method
  | "includes"        // module includes mixin

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

export interface SymbolReference {
  nodeId: string
  filePath: string
  line: number
  column: number
  kind: "definition" | "call" | "import" | "export" | "type_ref" | "access"
}

export interface CallSite {
  callerId: string
  calleeName: string
  calleeId?: string
  filePath: string
  line: number
  column: number
  isMemberAccess: boolean
  objectName?: string
}

export interface ImportInfo {
  sourcePath: string
  importedNames: string[]
  isDefault: boolean
  isNamespace: boolean
  filePath: string
  line: number
}

export interface TypeHierarchy {
  typeId: string
  superTypes: string[]
  subTypes: string[]
  implements: string[]
  implementedBy: string[]
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
