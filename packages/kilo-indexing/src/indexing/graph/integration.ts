// kilocode_change - new file
// Graph integration for the indexing pipeline

import { GraphDatabase } from "./database"
import { GraphBuilder } from "./builder"
import { GraphSearch } from "./search"
import { extractJavaScriptGraph } from "../extractor/javascript"
import type { ExtractedGraph } from "../extractor/javascript"
import type { RelationshipResult } from "./ast-relationships"
import { Log } from "../../util/log"

const log = Log.create({ service: "graph-integration" })

const JS_TS_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"])

export class GraphIntegration {
  db: GraphDatabase
  private builder: GraphBuilder
  search: GraphSearch
  private _ready = false

  constructor(cacheDirectory: string, workspacePath: string) {
    this.db = new GraphDatabase(cacheDirectory, workspacePath)
    this.builder = new GraphBuilder(this.db)
    this.search = new GraphSearch(this.db)
  }

  async initialize(): Promise<void> {
    if (this._ready) return
    await this.db.initialize()
    this._ready = true
    log.info("graph database initialized", { stats: this.db.getStats() })
  }

  async onFileParsed(
    filePath: string,
    _content: string,
    captures: Array<{ name: string; node: { text: string; startPosition: { row: number; column: number }; endPosition: { row: number; column: number } } }>,
    relationships?: RelationshipResult,
  ): Promise<void> {
    if (!this._ready) return
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()

    // Phase 1: Extract definitions from captures (first pass)
    let extracted: ExtractedGraph | undefined
    if (JS_TS_EXTS.has(ext)) {
      extracted = extractJavaScriptGraph(captures, filePath, ext.slice(1))
    }
    if (extracted) {
      if (extracted.nodes.length > 0) this.builder.addNodes(extracted.nodes)
      if (extracted.edges.length > 0) this.builder.addEdges(extracted.edges)
      if (extracted.symbols.length > 0) this.builder.addSymbols(extracted.symbols)
      if (extracted.imports.length > 0) this.builder.addImports(extracted.imports)
    }

    // Phase 2: Extract relationships from AST tree walk (second pass)
    // This is the GitNexus/Graphify-style approach that makes the graph actually useful
    if (relationships) {
      this.buildRelationshipEdges(filePath, relationships)
    }
  }

  private buildRelationshipEdges(filePath: string, rel: RelationshipResult): void {
    // Build import edges: file → imported module
    for (const imp of rel.imports) {
      // Store import edges with the module name as to_node for lookup
      this.builder.addEdges([{
        from: filePath,
        to: imp.source,
        kind: "imports",
        filePath,
        line: imp.line,
      }])
      // Also add to import_map table for dependency analysis
      this.builder.addImports([{
        sourcePath: imp.source,
        importedNames: imp.names,
        isDefault: imp.isDefault,
        isNamespace: imp.isNamespace,
        filePath,
        line: imp.line,
      }])
    }

    // Build call edges: caller file → callee name
    // We store callee NAME in to_node, then resolve to actual node at query time
    for (const call of rel.calls) {
      this.builder.addEdges([{
        from: filePath,
        to: call.callee,
        kind: "calls",
        filePath,
        line: call.line,
        column: call.column,
      }])
    }

    // Build extends edges: child class name → parent class name
    for (const ext of rel.extends) {
      this.builder.addEdges([{
        from: ext.child,
        to: ext.parent,
        kind: "extends",
        filePath,
        line: ext.line,
      }])
    }

    // Build implements edges: class name → interface name
    for (const impl of rel.implements) {
      this.builder.addEdges([{
        from: impl.child,
        to: impl.interface,
        kind: "implements",
        filePath,
        line: impl.line,
      }])
    }

    // Build export edges: file → exported symbol name
    for (const exp of rel.exports) {
      this.builder.addEdges([{
        from: filePath,
        to: exp.name,
        kind: "exports",
        filePath,
        line: exp.line,
      }])
    }
  }

  async onFileChanged(filePath: string): Promise<void> {
    if (!this._ready) return
    this.db.deleteFile(filePath)
  }

  async onScanComplete(): Promise<void> {
    if (!this._ready) return
    this.builder.flush()
    log.info("graph batch flush complete", { stats: this.db.getStats() })
  }

  getStats(): { nodes: number; edges: number; symbols: number; files: number } {
    return this.db.getStats()
  }

  async dispose(): Promise<void> {
    this.builder.flush()
    this.db.close()
  }
}
