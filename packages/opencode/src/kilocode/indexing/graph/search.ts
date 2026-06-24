// kilocode_change - new file
// Hybrid search: combines vector similarity with graph structure

import type { GraphDatabase } from "./database"
import type { GraphNode, GraphSearchResult } from "./types"
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "graph-search" })

interface VectorResult {
  filePath: string
  startLine: number
  endLine: number
  score: number
}

export class GraphSearch {
  constructor(private readonly db: GraphDatabase) {}

  /**
   * Hybrid search: re-rank vector results using graph centrality and relationships
   */
  async hybridSearch(
    vectorResults: VectorResult[],
    options: {
      vectorWeight?: number
      graphWeight?: number
      includeCallers?: boolean
      includeCallees?: boolean
      maxRelated?: number
    } = {},
  ): Promise<GraphSearchResult[]> {
    const { vectorWeight = 0.6, graphWeight = 0.4, includeCallers = true, includeCallees = true, maxRelated = 5 } = options

    const results: GraphSearchResult[] = []

    for (const vr of vectorResults) {
      // Find matching graph node by location
      const nodes = this.db.findNodesByFile(vr.filePath).filter(
        (n) => n.startLine <= vr.startLine && n.endLine >= vr.endLine,
      )

      if (nodes.length === 0) {
        // No graph node found — return plain vector result
        results.push({
          node: {
            id: `vec:${vr.filePath}:${vr.startLine}`,
            kind: "file",
            name: vr.filePath,
            filePath: vr.filePath,
            startLine: vr.startLine,
            endLine: vr.endLine,
          },
          score: vr.score,
          vectorScore: vr.score,
          graphScore: 0,
          callers: [],
          callees: [],
          related: [],
        })
        continue
      }

      const node = nodes[0]
      const graphScore = this.computeGraphScore(node)
      const finalScore = vr.score * vectorWeight + graphScore * graphWeight

      const callers = includeCallers ? this.db.getCallers(node.id).slice(0, maxRelated) : []
      const callees = includeCallees ? this.db.getCallees(node.id).slice(0, maxRelated) : []

      // Related: same parent (siblings)
      const related: GraphNode[] = []
      if (node.parentId) {
        const siblings = this.db
          .getEdgesFrom(node.parentId, "contains")
          .map((e) => this.db.getNode(e.to))
          .filter((n): n is GraphNode => n !== undefined && n.id !== node.id)
        related.push(...siblings.slice(0, maxRelated))
      }

      results.push({
        node,
        score: finalScore,
        vectorScore: vr.score,
        graphScore,
        callers,
        callees,
        related,
      })
    }

    return results.sort((a, b) => b.score - a.score)
  }

  /**
   * Pure graph search by symbol name
   */
  searchByName(name: string, kinds?: string[]): GraphNode[] {
    return this.db.findNodesByName(name, kinds as any)
  }

  /**
   * Find all references to a symbol
   */
  findReferences(nodeId: string): Array<{ node: GraphNode; kind: string; line: number }> {
    const node = this.db.getNode(nodeId)
    if (!node) return []

    const refs: Array<{ node: GraphNode; kind: string; line: number }> = []

    // Direct call edges
    const callers = this.db.getEdgesTo(nodeId, "calls")
    for (const edge of callers) {
      const caller = this.db.getNode(edge.from)
      if (caller) refs.push({ node: caller, kind: "call", line: edge.line })
    }

    // Reference edges
    const references = this.db.getEdgesTo(nodeId, "references")
    for (const edge of references) {
      const ref = this.db.getNode(edge.from)
      if (ref) refs.push({ node: ref, kind: "reference", line: edge.line })
    }

    // Access edges
    const accesses = this.db.getEdgesTo(nodeId, "accesses")
    for (const edge of accesses) {
      const acc = this.db.getNode(edge.from)
      if (acc) refs.push({ node: acc, kind: "access", line: edge.line })
    }

    return refs
  }

  /**
   * Get call hierarchy for a function/method
   */
  getCallHierarchy(nodeId: string, direction: "incoming" | "outgoing" | "both" = "both", maxDepth = 3): {
    incoming: Array<{ node: GraphNode; depth: number; path: string[] }>
    outgoing: Array<{ node: GraphNode; depth: number; path: string[] }>
  } {
    const incoming: Array<{ node: GraphNode; depth: number; path: string[] }> = []
    const outgoing: Array<{ node: GraphNode; depth: number; path: string[] }> = []

    if (direction === "incoming" || direction === "both") {
      this.traverseCallers(nodeId, 0, maxDepth, [nodeId], incoming)
    }

    if (direction === "outgoing" || direction === "both") {
      this.traverseCallees(nodeId, 0, maxDepth, [nodeId], outgoing)
    }

    return { incoming, outgoing }
  }

  private traverseCallers(
    nodeId: string,
    depth: number,
    maxDepth: number,
    path: string[],
    result: Array<{ node: GraphNode; depth: number; path: string[] }>,
  ): void {
    if (depth >= maxDepth) return

    const edges = this.db.getEdgesTo(nodeId, "calls")
    for (const edge of edges) {
      if (path.includes(edge.from)) continue // cycle detection

      const node = this.db.getNode(edge.from)
      if (!node) continue

      result.push({ node, depth: depth + 1, path: [...path, edge.from] })
      this.traverseCallers(edge.from, depth + 1, maxDepth, [...path, edge.from], result)
    }
  }

  private traverseCallees(
    nodeId: string,
    depth: number,
    maxDepth: number,
    path: string[],
    result: Array<{ node: GraphNode; depth: number; path: string[] }>,
  ): void {
    if (depth >= maxDepth) return

    const edges = this.db.getEdgesFrom(nodeId, "calls")
    for (const edge of edges) {
      if (path.includes(edge.to)) continue // cycle detection

      const node = this.db.getNode(edge.to)
      if (!node) continue

      result.push({ node, depth: depth + 1, path: [...path, edge.to] })
      this.traverseCallees(edge.to, depth + 1, maxDepth, [...path, edge.to], result)
    }
  }

  /**
   * Compute graph-based relevance score for a node
   */
  private computeGraphScore(node: GraphNode): number {
    let score = 0

    // Centrality: more connections = more important
    const outDegree = this.db.getEdgesFrom(node.id).length
    const inDegree = this.db.getEdgesTo(node.id).length
    score += Math.min(outDegree * 0.05, 0.3)
    score += Math.min(inDegree * 0.05, 0.3)

    // Prefer definitions over references
    if (["class", "function", "method", "interface"].includes(node.kind)) {
      score += 0.2
    }

    // Prefer exported symbols
    const symbolRows = this.db
      .getEdgesFrom(node.id)
      .filter((e) => e.kind === "exports")
    if (symbolRows.length > 0) {
      score += 0.1
    }

    return Math.min(score, 1)
  }
}
