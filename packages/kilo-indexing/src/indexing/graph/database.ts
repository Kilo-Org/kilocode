// kilocode_change - new file
// Native SQLite graph database for codebase intelligence

import { Database } from "bun:sqlite"
import path from "path"
import { createHash } from "crypto"
import { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION } from "./schema"
import type { GraphNode, GraphEdge, GraphEdgeKind, GraphNodeKind, DependencyChain } from "./types"

const SCHEMA_KEY = "graph_schema_version"

export class GraphDatabase {
  private db: Database
  private readonly dbPath: string
  private _ready = false

  constructor(cacheDirectory: string, workspacePath: string) {
    const hash = createHash("sha256").update(workspacePath).digest("hex")
    const dbName = `codebase-graph-${hash}.db`
    this.dbPath = path.join(cacheDirectory, dbName)
    this.db = new Database(this.dbPath)
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA synchronous = NORMAL")
  }

  async initialize(): Promise<void> {
    if (this._ready) return
    this.db.exec(GRAPH_SCHEMA)
    const version = this.getMetadata(SCHEMA_KEY)
    if (version && version !== GRAPH_SCHEMA_VERSION) {
      await this.migrate(version)
    }
    this.setMetadata(SCHEMA_KEY, GRAPH_SCHEMA_VERSION)
    this._ready = true
  }

  private migrate(fromVersion: string): Promise<void> {
    if (fromVersion !== GRAPH_SCHEMA_VERSION) {
      this.clearAll()
    }
    return Promise.resolve()
  }

  private getMetadata(key: string): string | undefined {
    const row = this.db.query("SELECT value FROM graph_metadata WHERE key = ?").get(key) as
      | { value: string }
      | undefined
    return row?.value
  }

  private setMetadata(key: string, value: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO graph_metadata (key, value, updated_at) VALUES (?, ?, unixepoch())",
      [key, value],
    )
  }

  insertNode(node: GraphNode): void {
    this.db.run(
      `INSERT OR REPLACE INTO graph_nodes
       (id, kind, name, file_path, start_line, end_line, signature, language, parent_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        node.id, node.kind, node.name, node.filePath, node.startLine, node.endLine,
        node.signature ?? null, node.language ?? null, node.parentId ?? null,
        node.metadata ? JSON.stringify(node.metadata) : null,
      ],
    )
  }

  insertNodes(nodes: GraphNode[]): void {
    const insert = this.db.query(
      `INSERT OR REPLACE INTO graph_nodes
       (id, kind, name, file_path, start_line, end_line, signature, language, parent_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const node of nodes) {
      insert.run(node.id, node.kind, node.name, node.filePath, node.startLine, node.endLine,
        node.signature ?? null, node.language ?? null, node.parentId ?? null,
        node.metadata ? JSON.stringify(node.metadata) : null)
    }
  }

  getNode(id: string): GraphNode | undefined {
    const row = this.db.query("SELECT * FROM graph_nodes WHERE id = ?").get(id) as Record<string, unknown> | undefined
    return row ? this.rowToNode(row) : undefined
  }

  findNodesByName(name: string, kind?: GraphNodeKind): GraphNode[] {
    const sql = kind
      ? "SELECT * FROM graph_nodes WHERE name = ? AND kind = ?"
      : "SELECT * FROM graph_nodes WHERE name = ?"
    const params = kind ? [name, kind] : [name]
    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  findNodesByFile(filePath: string): GraphNode[] {
    const rows = this.db.query("SELECT * FROM graph_nodes WHERE file_path = ? ORDER BY start_line").all(filePath) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  insertEdge(edge: Omit<GraphEdge, "id">): void {
    this.db.run(
      `INSERT OR IGNORE INTO graph_edges (from_node, to_node, kind, file_path, line, column)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [edge.from, edge.to, edge.kind, edge.filePath, edge.line, edge.column ?? null],
    )
  }

  insertEdges(edges: Omit<GraphEdge, "id">[]): void {
    const insert = this.db.query(
      `INSERT OR IGNORE INTO graph_edges (from_node, to_node, kind, file_path, line, column)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const edge of edges) {
      insert.run(edge.from, edge.to, edge.kind, edge.filePath, edge.line, edge.column ?? null)
    }
  }

  getEdgesFrom(nodeId: string, kind?: GraphEdgeKind): GraphEdge[] {
    const sql = kind
      ? "SELECT * FROM graph_edges WHERE from_node = ? AND kind = ?"
      : "SELECT * FROM graph_edges WHERE from_node = ?"
    const params = kind ? [nodeId, kind] : [nodeId]
    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToEdge(r))
  }

  getEdgesTo(nodeId: string, kind?: GraphEdgeKind): GraphEdge[] {
    const sql = kind
      ? "SELECT * FROM graph_edges WHERE to_node = ? AND kind = ?"
      : "SELECT * FROM graph_edges WHERE to_node = ?"
    const params = kind ? [nodeId, kind] : [nodeId]
    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToEdge(r))
  }

  insertSymbol(name: string, nodeId: string, filePath: string, kind: GraphNodeKind, scopeId?: string, isExported = false): void {
    this.db.run(
      `INSERT OR REPLACE INTO symbol_table (name, node_id, file_path, kind, scope_id, is_exported)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, nodeId, filePath, kind, scopeId ?? null, isExported ? 1 : 0],
    )
  }

  insertSymbols(symbols: Array<{ name: string; nodeId: string; filePath: string; kind: GraphNodeKind; scopeId?: string; isExported?: boolean }>): void {
    const insert = this.db.query(
      `INSERT OR REPLACE INTO symbol_table (name, node_id, file_path, kind, scope_id, is_exported)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const s of symbols) {
      insert.run(s.name, s.nodeId, s.filePath, s.kind, s.scopeId ?? null, s.isExported ? 1 : 0)
    }
  }

  resolveSymbol(name: string, filePath?: string): GraphNode[] {
    let sql = "SELECT n.* FROM graph_nodes n JOIN symbol_table s ON n.id = s.node_id WHERE s.name = ?"
    const params: (string | number)[] = [name]
    if (filePath) {
      sql += " AND s.file_path = ?"
      params.push(filePath)
    }
    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  insertImport(info: { sourcePath: string; importedNames: string[]; isDefault: boolean; isNamespace: boolean; filePath: string; line: number }): void {
    for (const name of info.importedNames) {
      this.db.run(
        `INSERT OR REPLACE INTO import_map (file_path, source_path, imported_name, local_name, is_default, is_namespace, line)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [info.filePath, info.sourcePath, name, info.isNamespace ? "*" : name, info.isDefault ? 1 : 0, info.isNamespace ? 1 : 0, info.line],
      )
    }
  }

  getImports(filePath: string): Array<{ sourcePath: string; importedNames: string[]; isDefault: boolean; isNamespace: boolean; filePath: string; line: number }> {
    const rows = this.db.query("SELECT * FROM import_map WHERE file_path = ?").all(filePath) as Record<string, unknown>[]
    const grouped = new Map<string, { sourcePath: string; importedNames: string[]; isDefault: boolean; isNamespace: boolean; filePath: string; line: number }>()
    for (const row of rows) {
      const source = row.source_path as string
      if (!grouped.has(source)) {
        grouped.set(source, { sourcePath: source, importedNames: [], isDefault: Boolean(row.is_default), isNamespace: Boolean(row.is_namespace), filePath: row.file_path as string, line: row.line as number })
      }
      grouped.get(source)!.importedNames.push(row.imported_name as string)
    }
    return [...grouped.values()]
  }

  getImportedBy(filePath: string): string[] {
    const rows = this.db.query("SELECT DISTINCT file_path FROM import_map WHERE source_path = ?").all(filePath) as Array<{ file_path: string }>
    return rows.map((r) => r.file_path)
  }

  getCallers(nodeId: string): GraphNode[] {
    // Find edges where to_node = node name (callee name) and kind = 'calls'
    // from_node is the file path where the call happened
    const node = this.getNode(nodeId)
    if (!node) return []
    const edgeRows = this.db.query(
      `SELECT from_node, file_path, line FROM graph_edges WHERE to_node = ? AND kind = 'calls'`,
    ).all(node.name) as Array<{ from_node: string; file_path: string; line: number }>
    if (edgeRows.length === 0) return []
    // Return function/method nodes in the calling files near the call line
    const result: GraphNode[] = []
    for (const edge of edgeRows) {
      const fileNodes = this.findNodesByFile(edge.file_path)
      // Find the function/method that contains this call site
      const caller = fileNodes.find((n) =>
        (n.kind === "function" || n.kind === "method") &&
        n.startLine <= edge.line && n.endLine >= edge.line,
      )
      if (caller && !result.find((r) => r.id === caller.id)) {
        result.push(caller)
      }
    }
    return result
  }

  getCallees(nodeId: string): GraphNode[] {
    // Find the file containing this node, then find all calls from that file
    const node = this.getNode(nodeId)
    if (!node) return []
    const edgeRows = this.db.query(
      `SELECT to_node FROM graph_edges WHERE from_node = ? AND kind = 'calls'`,
    ).all(node.filePath) as Array<{ to_node: string }>
    if (edgeRows.length === 0) return []
    // Resolve callee names to actual nodes
    const result: GraphNode[] = []
    for (const edge of edgeRows) {
      const calleeNodes = this.findNodesByName(edge.to_node)
      for (const n of calleeNodes) {
        if (!result.find((r) => r.id === n.id)) result.push(n)
      }
    }
    return result
  }

  getSubclasses(className: string): GraphNode[] {
    // Find edges where to_node = className and kind = 'extends'
    // from_node is the child class name
    const edgeRows = this.db.query(
      `SELECT from_node FROM graph_edges WHERE to_node = ? AND kind = 'extends'`,
    ).all(className) as Array<{ from_node: string }>
    const result: GraphNode[] = []
    for (const edge of edgeRows) {
      const childNodes = this.findNodesByName(edge.from_node, "class")
      for (const n of childNodes) {
        if (!result.find((r) => r.id === n.id)) result.push(n)
      }
    }
    return result
  }

  getSuperclasses(className: string): GraphNode[] {
    // Find edges where from_node = className and kind = 'extends'
    // to_node is the parent class name
    const edgeRows = this.db.query(
      `SELECT to_node FROM graph_edges WHERE from_node = ? AND kind = 'extends'`,
    ).all(className) as Array<{ to_node: string }>
    const result: GraphNode[] = []
    for (const edge of edgeRows) {
      const parentNodes = this.findNodesByName(edge.to_node, "class")
      for (const n of parentNodes) {
        if (!result.find((r) => r.id === n.id)) result.push(n)
      }
    }
    return result
  }

  getDependencyChain(filePath: string, maxDepth = 5): DependencyChain[] {
    const result: DependencyChain[] = []
    const visited = new Set<string>()
    const queue: Array<{ path: string; depth: number }> = [{ path: filePath, depth: 0 }]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current.path) || current.depth > maxDepth) continue
      visited.add(current.path)
      const imports = this.getImports(current.path).map((i) => i.sourcePath)
      const importedBy = this.getImportedBy(current.path)
      result.push({ filePath: current.path, imports, importedBy, depth: current.depth })
      for (const imp of imports) {
        if (!visited.has(imp)) queue.push({ path: imp, depth: current.depth + 1 })
      }
    }
    return result
  }

  findCircularDependencies(): string[][] {
    const files = this.db.query("SELECT DISTINCT file_path FROM import_map").all() as Array<{ file_path: string }>
    const adj = new Map<string, Set<string>>()
    for (const { file_path } of files) {
      if (!adj.has(file_path)) adj.set(file_path, new Set())
      const imports = this.getImports(file_path)
      for (const imp of imports) adj.get(file_path)!.add(imp.sourcePath)
    }
    const index = new Map<string, number>()
    const lowlink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    let idx = 0
    const sccs: string[][] = []
    const strongconnect = (v: string) => {
      index.set(v, idx); lowlink.set(v, idx); idx++
      stack.push(v); onStack.add(v)
      for (const w of adj.get(v) ?? []) {
        if (!index.has(w)) { strongconnect(w); lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!)) }
        else if (onStack.has(w)) { lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!)) }
      }
      if (lowlink.get(v) === index.get(v)) {
        const scc: string[] = []
        let w: string
        do { w = stack.pop()!; onStack.delete(w); scc.push(w) } while (w !== v)
        if (scc.length > 1) sccs.push(scc)
      }
    }
    for (const v of adj.keys()) if (!index.has(v)) strongconnect(v)
    return sccs
  }

  searchNodes(query: string, kinds?: GraphNodeKind[], limit = 50): GraphNode[] {
    const pattern = `%${query}%`
    let sql = "SELECT * FROM graph_nodes WHERE name LIKE ?"
    const params: (string | number)[] = [pattern]
    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => "?").join(", ")})`
      params.push(...kinds)
    }
    sql += " LIMIT ?"; params.push(limit)
    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  deleteFile(filePath: string): void {
    this.db.run("DELETE FROM graph_edges WHERE file_path = ?", [filePath])
    this.db.run("DELETE FROM symbol_table WHERE file_path = ?", [filePath])
    this.db.run("DELETE FROM import_map WHERE file_path = ?", [filePath])
    this.db.run("DELETE FROM graph_nodes WHERE file_path = ?", [filePath])
  }

  deleteFiles(filePaths: string[]): void {
    const placeholders = filePaths.map(() => "?").join(", ")
    this.db.run(`DELETE FROM graph_edges WHERE file_path IN (${placeholders})`, filePaths)
    this.db.run(`DELETE FROM symbol_table WHERE file_path IN (${placeholders})`, filePaths)
    this.db.run(`DELETE FROM import_map WHERE file_path IN (${placeholders})`, filePaths)
    this.db.run(`DELETE FROM graph_nodes WHERE file_path IN (${placeholders})`, filePaths)
  }

  clearAll(): void {
    this.db.run("DELETE FROM graph_edges")
    this.db.run("DELETE FROM symbol_table")
    this.db.run("DELETE FROM import_map")
    this.db.run("DELETE FROM graph_nodes")
    this.db.run("DELETE FROM graph_metadata")
  }

  close(): void {
    this.db.close()
  }

  getStats(): { nodes: number; edges: number; symbols: number; files: number } {
    const nodes = (this.db.query("SELECT COUNT(*) as c FROM graph_nodes").get() as { c: number }).c
    const edges = (this.db.query("SELECT COUNT(*) as c FROM graph_edges").get() as { c: number }).c
    const symbols = (this.db.query("SELECT COUNT(*) as c FROM symbol_table").get() as { c: number }).c
    const files = (this.db.query("SELECT COUNT(DISTINCT file_path) as c FROM graph_nodes").get() as { c: number }).c
    return { nodes, edges, symbols, files }
  }

  // kilocode_change - enterprise graph analysis methods

  getImpactAnalysis(symbolName: string, maxDepth = 3): Array<{ depth: number; node: GraphNode; relation: string; confidence: number }> {
    const targets = this.findNodesByName(symbolName)
    if (targets.length === 0) return []
    const result: Array<{ depth: number; node: GraphNode; relation: string; confidence: number }> = []
    const visited = new Set<string>()
    const queue: Array<{ id: string; depth: number }> = targets.map((t) => ({ id: t.id, depth: 0 }))
    for (const t of targets) visited.add(t.id)

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.depth >= maxDepth) continue

      const callers = this.getCallers(current.id)
      for (const caller of callers) {
        if (!visited.has(caller.id)) {
          visited.add(caller.id)
          const confidence = Math.max(0.5, 1.0 - current.depth * 0.2)
          result.push({ depth: current.depth + 1, node: caller, relation: "calls", confidence })
          queue.push({ id: caller.id, depth: current.depth + 1 })
        }
      }

      const callees = this.getCallees(current.id)
      for (const callee of callees) {
        if (!visited.has(callee.id)) {
          visited.add(callee.id)
          const confidence = Math.max(0.5, 1.0 - current.depth * 0.2)
          result.push({ depth: current.depth + 1, node: callee, relation: "called_by", confidence })
          queue.push({ id: callee.id, depth: current.depth + 1 })
        }
      }

      const imports = this.getEdgesTo(current.id, "imports")
      for (const edge of imports) {
        const importer = this.getNode(edge.from)
        if (importer && !visited.has(importer.id)) {
          visited.add(importer.id)
          const confidence = Math.max(0.4, 0.9 - current.depth * 0.15)
          result.push({ depth: current.depth + 1, node: importer, relation: "imports", confidence })
          queue.push({ id: importer.id, depth: current.depth + 1 })
        }
      }

      const extendsEdges = this.getEdgesTo(current.id, "extends")
      for (const edge of extendsEdges) {
        const child = this.getNode(edge.from)
        if (child && !visited.has(child.id)) {
          visited.add(child.id)
          result.push({ depth: current.depth + 1, node: child, relation: "extends", confidence: 1.0 })
          queue.push({ id: child.id, depth: current.depth + 1 })
        }
      }
    }

    return result.sort((a, b) => b.confidence - a.confidence || a.depth - b.depth)
  }

  getShortestPath(fromSymbol: string, toSymbol: string): GraphNode[] | undefined {
    const fromNodes = this.findNodesByName(fromSymbol)
    const toNodes = this.findNodesByName(toSymbol)
    if (fromNodes.length === 0 || toNodes.length === 0) return undefined

    const targetIds = new Set(toNodes.map((n) => n.id))
    const visited = new Map<string, { prev: string; edgeKind: string }>()
    const queue: string[] = fromNodes.map((n) => n.id)
    for (const n of fromNodes) visited.set(n.id, { prev: "", edgeKind: "start" })

    while (queue.length > 0) {
      const current = queue.shift()!
      if (targetIds.has(current)) {
        const path: GraphNode[] = []
        let id = current
        while (id) {
          const node = this.getNode(id)
          if (node) path.unshift(node)
          const prev = visited.get(id)
          if (!prev || prev.prev === "") break
          id = prev.prev
        }
        return path
      }

      const edges = this.db.query("SELECT * FROM graph_edges WHERE from_node = ? OR to_node = ?").all(current, current) as Record<string, unknown>[]
      for (const row of edges) {
        const edge = this.rowToEdge(row)
        const next = edge.from === current ? edge.to : edge.from
        if (!visited.has(next)) {
          visited.set(next, { prev: current, edgeKind: edge.kind })
          queue.push(next)
        }
      }
    }

    return undefined
  }

  getSymbolContext(symbolName: string): {
    definitions: GraphNode[]
    callers: GraphNode[]
    callees: GraphNode[]
    subclasses: GraphNode[]
    superclasses: GraphNode[]
    imports: Array<{ sourcePath: string; importedNames: string[] }>
    importedBy: string[]
  } {
    const definitions = this.findNodesByName(symbolName)
    const callers: GraphNode[] = []
    const callees: GraphNode[] = []
    const subclasses: GraphNode[] = []
    const superclasses: GraphNode[] = []
    const imports: Array<{ sourcePath: string; importedNames: string[] }> = []
    const importedBy: string[] = []

    for (const def of definitions) {
      for (const c of this.getCallers(def.id)) if (!callers.find((x) => x.id === c.id)) callers.push(c)
      for (const c of this.getCallees(def.id)) if (!callees.find((x) => x.id === c.id)) callees.push(c)
      for (const s of this.getSubclasses(def.name)) if (!subclasses.find((x) => x.id === s.id)) subclasses.push(s)
      for (const s of this.getSuperclasses(def.name)) if (!superclasses.find((x) => x.id === s.id)) superclasses.push(s)
      for (const imp of this.getImports(def.filePath)) if (!imports.find((x) => x.sourcePath === imp.sourcePath)) imports.push(imp)
      for (const ib of this.getImportedBy(def.filePath)) if (!importedBy.includes(ib)) importedBy.push(ib)
    }

    return { definitions, callers, callees, subclasses, superclasses, imports, importedBy }
  }

  rawQuery(sql: string, params?: (string | number)[]): unknown[] {
    const stmt = this.db.query(sql)
    return params ? stmt.all(...params) : stmt.all()
  }

  private rowToNode(row: Record<string, unknown>): GraphNode {
    return {
      id: row.id as string, kind: row.kind as GraphNodeKind, name: row.name as string,
      filePath: row.file_path as string, startLine: row.start_line as number, endLine: row.end_line as number,
      signature: (row.signature as string) ?? undefined, language: (row.language as string) ?? undefined,
      parentId: (row.parent_id as string) ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    }
  }

  private rowToEdge(row: Record<string, unknown>): GraphEdge {
    return {
      id: row.id as number, from: row.from_node as string, to: row.to_node as string,
      kind: row.kind as GraphEdgeKind, filePath: row.file_path as string,
      line: row.line as number, column: (row.column as number) ?? undefined,
    }
  }
}
