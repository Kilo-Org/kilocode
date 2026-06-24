// kilocode_change - new file
// Graph builder: orchestrates AST extraction and graph persistence

import type { GraphDatabase } from "./database"
import type { ExtractedRelationships } from "../extractor/types"
import type { GraphNode, GraphEdge } from "./types"
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "graph-builder" })

export class GraphBuilder {
  private batchNodes: GraphNode[] = []
  private batchEdges: Omit<GraphEdge, "id">[] = []
  private batchSymbols: ExtractedRelationships["symbols"] = []
  private batchImports: ExtractedRelationships["imports"] = []
  private flushThreshold = 500

  constructor(private readonly db: GraphDatabase) {}

  async addFileRelationships(extracted: ExtractedRelationships): Promise<void> {
    this.batchNodes.push(...extracted.nodes)
    this.batchEdges.push(...extracted.edges)
    this.batchSymbols.push(...extracted.symbols)
    this.batchImports.push(...extracted.imports)

    if (this.batchNodes.length >= this.flushThreshold) {
      await this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.batchNodes.length === 0) return

    log.info("flushing graph batch", {
      nodes: this.batchNodes.length,
      edges: this.batchEdges.length,
      symbols: this.batchSymbols.length,
      imports: this.batchImports.length,
    })

    this.db.insertNodes(this.batchNodes)
    this.db.insertEdges(this.batchEdges)
    this.db.insertSymbols(this.batchSymbols)
    for (const imp of this.batchImports) {
      this.db.insertImport(imp)
    }

    this.batchNodes = []
    this.batchEdges = []
    this.batchSymbols = []
    this.batchImports = []
  }

  async finalize(): Promise<void> {
    await this.flush()
    log.info("graph build finalized", this.db.getStats())
  }

  async removeFile(filePath: string): Promise<void> {
    this.db.deleteFile(filePath)
  }

  async removeFiles(filePaths: string[]): Promise<void> {
    this.db.deleteFiles(filePaths)
  }

  async clear(): Promise<void> {
    this.db.clearAll()
  }
}
