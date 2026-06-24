// kilocode_change - new file
// Hybrid graph + vector search for codebase intelligence

import { GraphDatabase } from "./database"
import type { GraphNode, GraphSearchResult, GraphEdgeKind } from "./types"

export class GraphSearch {
  constructor(private db: GraphDatabase) {}

  search(query: string, options?: { kinds?: GraphNode["kind"][]; limit?: number; includeGraphContext?: boolean }): GraphSearchResult[] {
    const { kinds, limit = 20, includeGraphContext = true } = options ?? {}
    const nodes = this.db.searchNodes(query, kinds, limit * 2)
    const results: GraphSearchResult[] = []
    for (const node of nodes) {
      const callers = includeGraphContext ? this.db.getCallers(node.id) : []
      const callees = includeGraphContext ? this.db.getCallees(node.id) : []
      const related = includeGraphContext ? this.getRelatedNodes(node.id) : []
      const graphScore = includeGraphContext ? this.computeGraphScore(node, callers, callees, related) : undefined
      const score = includeGraphContext ? (1.0 + graphScore!) / 2 : 1.0
      results.push({ node, score, callers, callees, related, graphScore })
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  findReferences(symbolName: string, filePath?: string): { definitions: GraphNode[]; references: GraphNode[] } {
    const definitions = this.db.resolveSymbol(symbolName, filePath)
    const references: GraphNode[] = []
    for (const def of definitions) {
      const refs = this.db.getEdgesTo(def.id, "references")
      for (const edge of refs) {
        const node = this.db.getNode(edge.from)
        if (node) references.push(node)
      }
    }
    return { definitions, references }
  }

  getCallHierarchy(symbolName: string): { callers: GraphNode[]; callees: GraphNode[]; transitiveCallers: GraphNode[]; transitiveCallees: GraphNode[] } {
    const nodes = this.db.findNodesByName(symbolName)
    const callers: GraphNode[] = []
    const callees: GraphNode[] = []
    const transitiveCallers: GraphNode[] = []
    const transitiveCallees: GraphNode[] = []
    const visitedUp = new Set<string>()
    const visitedDown = new Set<string>()

    for (const node of nodes) {
      const directCallers = this.db.getCallers(node.id)
      callers.push(...directCallers)
      const directCallees = this.db.getCallees(node.id)
      callees.push(...directCallees)

      const queueUp = directCallers.map((n) => n.id)
      while (queueUp.length > 0) {
        const id = queueUp.shift()!
        if (visitedUp.has(id)) continue
        visitedUp.add(id)
        const n = this.db.getNode(id)
        if (n) transitiveCallers.push(n)
        const next = this.db.getCallers(id)
        queueUp.push(...next.map((x) => x.id))
      }

      const queueDown = directCallees.map((n) => n.id)
      while (queueDown.length > 0) {
        const id = queueDown.shift()!
        if (visitedDown.has(id)) continue
        visitedDown.add(id)
        const n = this.db.getNode(id)
        if (n) transitiveCallees.push(n)
        const next = this.db.getCallees(id)
        queueDown.push(...next.map((x) => x.id))
      }
    }

    return { callers, callees, transitiveCallers, transitiveCallees }
  }

  getDependencyGraph(filePath: string, maxDepth = 3): { nodes: GraphNode[]; edges: Array<{ from: string; to: string; kind: string }> } {
    const chain = this.db.getDependencyChain(filePath, maxDepth)
    const nodeIds = new Set<string>()
    const edgeList: Array<{ from: string; to: string; kind: string }> = []

    for (const item of chain) {
      const fileNode = this.db.findNodesByName(item.filePath, "file")[0]
      if (fileNode) nodeIds.add(fileNode.id)
      for (const imp of item.imports) {
        edgeList.push({ from: item.filePath, to: imp, kind: "imports" })
      }
    }

    const nodes: GraphNode[] = []
    for (const id of nodeIds) {
      const node = this.db.getNode(id)
      if (node) nodes.push(node)
    }

    return { nodes, edges: edgeList }
  }

  private getRelatedNodes(nodeId: string): GraphNode[] {
    const related: GraphNode[] = []
    const edgeKinds: GraphEdgeKind[] = ["contains", "extends", "implements", "references", "typed_by", "accesses"]
    for (const kind of edgeKinds) {
      for (const edge of this.db.getEdgesFrom(nodeId, kind)) {
        const node = this.db.getNode(edge.to)
        if (node) related.push(node)
      }
      for (const edge of this.db.getEdgesTo(nodeId, kind)) {
        const node = this.db.getNode(edge.from)
        if (node) related.push(node)
      }
    }
    return related
  }

  private computeGraphScore(node: GraphNode, callers: GraphNode[], callees: GraphNode[], related: GraphNode[]): number {
    let score = 0
    if (callers.length > 0) score += Math.min(callers.length * 0.1, 0.5)
    if (callees.length > 0) score += Math.min(callees.length * 0.1, 0.5)
    if (related.length > 0) score += Math.min(related.length * 0.05, 0.3)
    if (node.kind === "class" || node.kind === "interface") score += 0.2
    return Math.min(score, 1.0)
  }
}
