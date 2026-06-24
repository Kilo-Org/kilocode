// kilocode_change - new file
// Native SQLite graph database for codebase intelligence

import { Database } from "bun:sqlite"
import path from "path"
import { createHash } from "crypto"
import { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION } from "./schema"
import type {
  GraphNode,
  GraphEdge,
  GraphEdgeKind,
  GraphNodeKind,
  SymbolReference,
  CallSite,
  ImportInfo,
  TypeHierarchy,
  GraphSearchResult,
  DependencyChain,
} from "./types"

const SCHEMA_KEY = "graph_schema_version";

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
    // Future migrations go here
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

  // ─── Node Operations ───

  insertNode(node: GraphNode): void {
    this.db.run(
      `INSERT OR REPLACE INTO graph_nodes
       (id, kind, name, file_path, start_line, end_line, signature, language, parent_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        node.id,
        node.kind,
        node.name,
        node.filePath,
        node.startLine,
        node.endLine,
        node.signature ?? null,
        node.language ?? null,
        node.parentId ?? null,
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
      insert.run(
        node.id,
        node.kind,
        node.name,
        node.filePath,
        node.startLine,
        node.endLine,
        node.signature ?? null,
        node.language ?? null,
        node.parentId ?? null,
        node.metadata ? JSON.stringify(node.metadata) : null,
      )
    }
  }

  getNode(id: string): GraphNode | undefined {
    const row = this.db.query("SELECT * FROM graph_nodes WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return undefined
    return this.rowToNode(row)
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
    const rows = this.db.query("SELECT * FROM graph_nodes WHERE file_path = ? ORDER BY start_line").all(filePath) as
      Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  findNodesByKind(kind: GraphNodeKind, filePath?: string): GraphNode[] {
    const sql = filePath
      ? "SELECT * FROM graph_nodes WHERE kind = ? AND file_path = ?"
      : "SELECT * FROM graph_nodes WHERE kind = ?"
    const params = filePath ? [kind, filePath] : [kind]
    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  // ─── Edge Operations ───

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

  // ─── Symbol Table ───

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

  resolveSymbol(name: string, filePath?: string, scopeId?: string): GraphNode[] {
    let sql = "SELECT n.* FROM graph_nodes n JOIN symbol_table s ON n.id = s.node_id WHERE s.name = ?"
    const params: (string | number)[] = [name]

    if (filePath) {
      sql += " AND s.file_path = ?"
      params.push(filePath)
    }
    if (scopeId) {
      sql += " AND (s.scope_id = ? OR s.scope_id IS NULL)"
      params.push(scopeId)
    }

    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  // ─── Import Map ───

  insertImport(info: ImportInfo): void {
    for (const name of info.importedNames) {
      this.db.run(
        `INSERT OR REPLACE INTO import_map
         (file_path, source_path, imported_name, local_name, is_default, is_namespace, line)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          info.filePath,
          info.sourcePath,
          name,
          info.isNamespace ? "*" : name,
          info.isDefault ? 1 : 0,
          info.isNamespace ? 1 : 0,
          info.line,
        ],
      )
    }
  }

  getImports(filePath: string): ImportInfo[] {
    const rows = this.db
      .query("SELECT * FROM import_map WHERE file_path = ?")
      .all(filePath) as Record<string, unknown>[]

    const grouped = new Map<string, ImportInfo>()
    for (const row of rows) {
      const source = row.source_path as string
      if (!grouped.has(source)) {
        grouped.set(source, {
          sourcePath: source,
          importedNames: [],
          isDefault: Boolean(row.is_default),
          isNamespace: Boolean(row.is_namespace),
          filePath: row.file_path as string,
          line: row.line as number,
        })
      }
      grouped.get(source)!.importedNames.push(row.imported_name as string)
    }

    return [...grouped.values()]
  }

  getImportedBy(filePath: string): string[] {
    const rows = this.db
      .query("SELECT DISTINCT file_path FROM import_map WHERE source_path = ?")
      .all(filePath) as Array<{ file_path: string }>
    return rows.map((r) => r.file_path)
  }

  // ─── Call Graph ───

  getCallers(nodeId: string): GraphNode[] {
    const rows = this.db.query(
      `SELECT n.* FROM graph_nodes n
       JOIN graph_edges e ON n.id = e.from_node
       WHERE e.to_node = ? AND e.kind = 'calls'`,
    ).all(nodeId) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  getCallees(nodeId: string): GraphNode[] {
    const rows = this.db.query(
      `SELECT n.* FROM graph_nodes n
       JOIN graph_edges e ON n.id = e.to_node
       WHERE e.from_node = ? AND e.kind = 'calls'`,
    ).all(nodeId) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  // ─── Type Hierarchy ───

  getTypeHierarchy(typeId: string): TypeHierarchy {
    const node = this.getNode(typeId)
    if (!node) return { typeId, superTypes: [], subTypes: [], implements: [], implementedBy: [] }

    const superEdges = this.getEdgesFrom(typeId, "extends")
    const superTypes = superEdges.map((e) => e.to)

    const implEdges = this.getEdgesFrom(typeId, "implements")
    const implements_ = implEdges.map((e) => e.to)

    const subEdges = this.getEdgesTo(typeId, "extends")
    const subTypes = subEdges.map((e) => e.from)

    const implByEdges = this.getEdgesTo(typeId, "implements")
    const implementedBy = implByEdges.map((e) => e.from)

    return { typeId, superTypes, subTypes, implements: implements_, implementedBy }
  }

  getSubclasses(className: string): GraphNode[] {
    const nodes = this.findNodesByName(className, "class")
    if (nodes.length === 0) return []

    const result: GraphNode[] = []
    const visited = new Set<string>()
    const queue = nodes.map((n) => n.id)

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)

      const children = this.getEdgesTo(current, "extends")
      for (const edge of children) {
        const child = this.getNode(edge.from)
        if (child) {
          result.push(child)
          queue.push(child.id)
        }
      }
    }

    return result
  }

  getSuperclasses(className: string): GraphNode[] {
    const nodes = this.findNodesByName(className, "class")
    if (nodes.length === 0) return []

    const result: GraphNode[] = []
    const visited = new Set<string>()
    const queue = nodes.map((n) => n.id)

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)

      const parents = this.getEdgesFrom(current, "extends")
      for (const edge of parents) {
        const parent = this.getNode(edge.to)
        if (parent) {
          result.push(parent)
          queue.push(parent.id)
        }
      }
    }

    return result
  }

  // ─── Dependency Analysis ───

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

      result.push({
        filePath: current.path,
        imports,
        importedBy,
        depth: current.depth,
      })

      for (const imp of imports) {
        if (!visited.has(imp)) {
          queue.push({ path: imp, depth: current.depth + 1 })
        }
      }
    }

    return result
  }

  findCircularDependencies(): string[][] {
    const files = this.db.query("SELECT DISTINCT file_path FROM import_map").all() as Array<{
      file_path: string
    }>

    const adj = new Map<string, Set<string>>()
    for (const { file_path } of files) {
      if (!adj.has(file_path)) adj.set(file_path, new Set())
      const imports = this.getImports(file_path)
      for (const imp of imports) {
        adj.get(file_path)!.add(imp.sourcePath)
      }
    }

    // Tarjan's SCC
    const index = new Map<string, number>()
    const lowlink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    let idx = 0
    const sccs: string[][] = []

    const strongconnect = (v: string) => {
      index.set(v, idx)
      lowlink.set(v, idx)
      idx++
      stack.push(v)
      onStack.add(v)

      for (const w of adj.get(v) ?? []) {
        if (!index.has(w)) {
          strongconnect(w)
          lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!))
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!))
        }
      }

      if (lowlink.get(v) === index.get(v)) {
        const scc: string[] = []
        let w: string
        do {
          w = stack.pop()!
          onStack.delete(w)
          scc.push(w)
        } while (w !== v)
        if (scc.length > 1) sccs.push(scc)
      }
    }

    for (const v of adj.keys()) {
      if (!index.has(v)) strongconnect(v)
    }

    return sccs
  }

  // ─── Search ───

  searchNodes(query: string, kinds?: GraphNodeKind[], limit = 50): GraphNode[] {
    const pattern = `%${query}%`
    let sql = "SELECT * FROM graph_nodes WHERE name LIKE ?"
    const params: (string | number)[] = [pattern]

    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => "?").join(", ")})`
      params.push(...kinds)
    }

    sql += " LIMIT ?"
    params.push(limit)

    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToNode(r))
  }

  // ─── File Lifecycle ───

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
    this.db.run("DELETE FROM file_dependencies")
    this.db.run("DELETE FROM graph_nodes")
    this.db.run("DELETE FROM graph_metadata")
  }

  close(): void {
    this.db.close()
  }

  // ─── Stats ───

  getStats(): { nodes: number; edges: number; symbols: number; files: number } {
    const nodes = (this.db.query("SELECT COUNT(*) as c FROM graph_nodes").get() as { c: number }).c
    const edges = (this.db.query("SELECT COUNT(*) as c FROM graph_edges").get() as { c: number }).c
    const symbols = (this.db.query("SELECT COUNT(*) as c FROM symbol_table").get() as { c: number }).c
    const files = (this.db.query("SELECT COUNT(DISTINCT file_path) as c FROM graph_nodes").get() as { c: number }).c
    return { nodes, edges, symbols, files }
  }

  // ─── Helpers ───

  private rowToNode(row: Record<string, unknown>): GraphNode {
    return {
      id: row.id as string,
      kind: row.kind as GraphNodeKind,
      name: row.name as string,
      filePath: row.file_path as string,
      startLine: row.start_line as number,
      endLine: row.end_line as number,
      signature: (row.signature as string) ?? undefined,
      language: (row.language as string) ?? undefined,
      parentId: (row.parent_id as string) ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    }
  }

  private rowToEdge(row: Record<string, unknown>): GraphEdge {
    return {
      id: row.id as number,
      from: row.from_node as string,
      to: row.to_node as string,
      kind: row.kind as GraphEdgeKind,
      filePath: row.file_path as string,
      line: row.line as number,
      column: (row.column as number) ?? undefined,
    }
  }
}
