// kilocode_change - new file
// Batch graph builder for efficient insertion during indexing

import { GraphDatabase } from "./database"
import type { GraphNode, GraphEdge } from "./types"

export class GraphBuilder {
  private nodes: GraphNode[] = []
  private edges: Omit<GraphEdge, "id">[] = []
  private symbols: Array<{ name: string; nodeId: string; filePath: string; kind: GraphNode["kind"]; scopeId?: string; isExported?: boolean }> = []
  private imports: Array<{ sourcePath: string; importedNames: string[]; isDefault: boolean; isNamespace: boolean; filePath: string; line: number }> = []
  private batchSize = 500

  constructor(private db: GraphDatabase) {}

  addNodes(nodes: GraphNode[]): void {
    this.nodes.push(...nodes)
    if (this.nodes.length >= this.batchSize) this.flushNodes()
  }

  addEdges(edges: Omit<GraphEdge, "id">[]): void {
    this.edges.push(...edges)
    if (this.edges.length >= this.batchSize) this.flushEdges()
  }

  addSymbols(symbols: Array<{ name: string; nodeId: string; filePath: string; kind: GraphNode["kind"]; scopeId?: string; isExported?: boolean }>): void {
    this.symbols.push(...symbols)
    if (this.symbols.length >= this.batchSize) this.flushSymbols()
  }

  addImports(imports: Array<{ sourcePath: string; importedNames: string[]; isDefault: boolean; isNamespace: boolean; filePath: string; line: number }>): void {
    this.imports.push(...imports)
    if (this.imports.length >= this.batchSize) this.flushImports()
  }

  flush(): void {
    this.flushNodes()
    this.flushEdges()
    this.flushSymbols()
    this.flushImports()
  }

  private flushNodes(): void {
    if (this.nodes.length === 0) return
    this.db.insertNodes(this.nodes)
    this.nodes = []
  }

  private flushEdges(): void {
    if (this.edges.length === 0) return
    this.db.insertEdges(this.edges)
    this.edges = []
  }

  private flushSymbols(): void {
    if (this.symbols.length === 0) return
    this.db.insertSymbols(this.symbols)
    this.symbols = []
  }

  private flushImports(): void {
    if (this.imports.length === 0) return
    for (const imp of this.imports) {
      this.db.insertImport(imp)
    }
    this.imports = []
  }
}
