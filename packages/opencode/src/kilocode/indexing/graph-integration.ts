// kilocode_change - new file
// Integration layer: hooks graph building into existing indexing pipeline

import path from "path"
import { GraphDatabase, GraphBuilder, GraphSearch } from "./graph"
import { extractJavaScript } from "./extractor"
import type { ExtractedRelationships } from "./extractor/types"
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "graph-integration" })

export interface GraphIntegrationConfig {
  enabled: boolean
  cacheDirectory: string
  workspacePath: string
}

export class GraphIntegration {
  private db?: GraphDatabase
  private builder?: GraphBuilder
  private search?: GraphSearch
  private _ready = false

  constructor(private readonly config: GraphIntegrationConfig) {}

  async initialize(): Promise<void> {
    if (!this.config.enabled || this._ready) return

    this.db = new GraphDatabase(this.config.cacheDirectory, this.config.workspacePath)
    await this.db.initialize()
    this.builder = new GraphBuilder(this.db)
    this.search = new GraphSearch(this.db)
    this._ready = true

    log.info("graph integration initialized", {
      workspacePath: this.config.workspacePath,
      stats: this.db.getStats(),
    })
  }

  get isReady(): boolean {
    return this._ready && this.db !== undefined
  }

  get database(): GraphDatabase | undefined {
    return this.db
  }

  get graphSearch(): GraphSearch | undefined {
    return this.search
  }

  /**
   * Hook: called after a file is parsed during scanning
   */
  async onFileParsed(
    filePath: string,
    captures: Array<{ node: { text: string; startPosition: { row: number; column: number }; endPosition: { row: number }; type: string }; name: string }>,
    language: string,
  ): Promise<void> {
    if (!this.isReady || !this.builder) return

    try {
      const ext = path.extname(filePath).toLowerCase()
      let extracted: ExtractedRelationships | undefined

      // Route to language-specific extractor
      if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
        extracted = extractJavaScript(filePath, captures, language)
      }
      // TODO: Add Python, Go, Rust, Java, etc. extractors

      if (extracted && extracted.nodes.length > 0) {
        await this.builder.addFileRelationships(extracted)
      }
    } catch (err) {
      log.error("failed to extract graph relationships", { filePath, err })
    }
  }

  /**
   * Hook: called when a file is modified (file watcher)
   */
  async onFileChanged(filePath: string): Promise<void> {
    if (!this.isReady || !this.builder) return
    await this.builder.removeFile(filePath)
  }

  /**
   * Hook: called when multiple files are modified
   */
  async onFilesChanged(filePaths: string[]): Promise<void> {
    if (!this.isReady || !this.builder) return
    await this.builder.removeFiles(filePaths)
  }

  /**
   * Hook: called after scan completes
   */
  async onScanComplete(): Promise<void> {
    if (!this.isReady || !this.builder) return
    await this.builder.finalize()
  }

  /**
   * Hook: called when indexing is cleared/reset
   */
  async onClear(): Promise<void> {
    if (!this.isReady || !this.builder) return
    await this.builder.clear()
  }

  // ─── Search APIs ───

  async findReferences(nodeId: string): Promise<Array<{ node: any; kind: string; line: number }>> {
    if (!this.search) throw new Error("Graph search not initialized")
    return this.search.findReferences(nodeId)
  }

  async getCallHierarchy(
    nodeId: string,
    direction: "incoming" | "outgoing" | "both" = "both",
    maxDepth = 3,
  ): Promise<{
    incoming: Array<{ node: any; depth: number; path: string[] }>
    outgoing: Array<{ node: any; depth: number; path: string[] }>
  }> {
    if (!this.search) throw new Error("Graph search not initialized")
    return this.search.getCallHierarchy(nodeId, direction, maxDepth)
  }

  async getSubclasses(className: string): Promise<any[]> {
    if (!this.db) throw new Error("Graph database not initialized")
    return this.db.getSubclasses(className)
  }

  async getSuperclasses(className: string): Promise<any[]> {
    if (!this.db) throw new Error("Graph database not initialized")
    return this.db.getSuperclasses(className)
  }

  async getDependencyChain(filePath: string, maxDepth = 5): Promise<any[]> {
    if (!this.db) throw new Error("Graph database not initialized")
    return this.db.getDependencyChain(filePath, maxDepth)
  }

  async findCircularDependencies(): Promise<string[][]> {
    if (!this.db) throw new Error("Graph database not initialized")
    return this.db.findCircularDependencies()
  }

  async searchNodes(query: string, kinds?: string[], limit = 50): Promise<any[]> {
    if (!this.db) throw new Error("Graph database not initialized")
    return this.db.searchNodes(query, kinds as any, limit)
  }

  async getStats(): Promise<{ nodes: number; edges: number; symbols: number; files: number }> {
    if (!this.db) return { nodes: 0, edges: 0, symbols: 0, files: 0 }
    return this.db.getStats()
  }

  dispose(): void {
    this.db?.close()
    this._ready = false
  }
}
