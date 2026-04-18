import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

// ─── Types ───────────────────────────────────────────────

export interface MemoryEntry {
  id: string
  project: string
  scope: "global" | "project" | "task"
  factType: "contract" | "fix" | "recall" | "decision"
  summary: string
  content: string
  traceRef: string
  timestamp: number
  agent?: string
}

export interface RecallResult {
  query: string
  project: string
  results: Array<MemoryEntry & { relevanceScore: number; matchReason: string; crossProject?: boolean }>
  status: "success" | "empty" | "failed"
  timestamp: number
}

export interface MemoryConnection {
  status: "connected" | "disconnected" | "error"
  endpoint: string
  lastPing?: number
  latencyMs?: number
  lastError?: string
}

export interface ConnectionEvent {
  type: "connected" | "disconnected" | "error"
  timestamp: number
  endpoint: string
  error?: string
}

export interface AgentPermission {
  agentId: string
  scopes: {
    global: boolean
    project: boolean
    task: boolean
  }
}

interface MemoryStore {
  entries: MemoryEntry[]
  writeHistory: WriteHistoryRecord[]
  permissions: AgentPermission[]
}

export interface WriteHistoryRecord {
  entryId: string
  summary: string
  factType: MemoryEntry["factType"]
  project: string
  scope: MemoryEntry["scope"]
  traceRef: string
  timestamp: number
}

// ─── TF-IDF Scoring ──────────────────────────────────────

interface TermFrequencies {
  [term: string]: number
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

function computeTF(tokens: string[]): TermFrequencies {
  const freq: TermFrequencies = {}
  for (const t of tokens) {
    freq[t] = (freq[t] ?? 0) + 1
  }
  const max = Math.max(...Object.values(freq), 1)
  for (const t of Object.keys(freq)) {
    freq[t] = freq[t] / max
  }
  return freq
}

function computeIDF(corpus: string[][], term: string): number {
  const containing = corpus.filter((doc) => doc.includes(term)).length
  if (containing === 0) return 0
  return Math.log(corpus.length / containing) + 1
}

function cosineSimilarity(a: TermFrequencies, b: TermFrequencies): number {
  const allTerms = new Set([...Object.keys(a), ...Object.keys(b)])
  let dot = 0
  let magA = 0
  let magB = 0
  for (const t of allTerms) {
    const va = a[t] ?? 0
    const vb = b[t] ?? 0
    dot += va * vb
    magA += va * va
    magB += vb * vb
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

// ─── Constants ──────────────────────────────────────────

const VALID_FACT_TYPES: ReadonlySet<MemoryEntry["factType"]> = new Set(["contract", "fix", "recall", "decision"])
const VALID_SCOPES: ReadonlySet<MemoryEntry["scope"]> = new Set(["global", "project", "task"])

// ─── Service ─────────────────────────────────────────────

export class MemoryService implements vscode.Disposable {
  private readonly maxMemoryEntries: number = 5000
  private store: MemoryStore = { entries: [], writeHistory: [], permissions: [] }
  private connection: MemoryConnection = {
    status: "disconnected",
    endpoint: "local://.kilo/memory.json",
  }
  private connectionHistory: ConnectionEvent[] = []
  private storeFilePath: string | undefined
  private savePending = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private pingTimer: ReturnType<typeof setInterval> | undefined

  private readonly _onConnectionChanged = new vscode.EventEmitter<MemoryConnection>()
  readonly onConnectionChanged = this._onConnectionChanged.event

  private readonly _onMemoryWritten = new vscode.EventEmitter<MemoryEntry>()
  readonly onMemoryWritten = this._onMemoryWritten.event

  private readonly _onRecallCompleted = new vscode.EventEmitter<RecallResult>()
  readonly onRecallCompleted = this._onRecallCompleted.event

  private readonly _onPermissionChanged = new vscode.EventEmitter<AgentPermission>()
  readonly onPermissionChanged = this._onPermissionChanged.event

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.resolveStorePath()
    this.loadStore()
    this.startPingLoop()
  }

  // ─── Connection ──────────────────────────────────────

  getConnection(): MemoryConnection {
    return { ...this.connection }
  }

  getConnectionHistory(): ConnectionEvent[] {
    return [...this.connectionHistory]
  }

  async reconnect(): Promise<MemoryConnection> {
    this.resolveStorePath()
    const started = Date.now()

    try {
      this.loadStore()
      const latency = Date.now() - started
      this.setConnection({
        status: "connected",
        endpoint: this.storeFilePath ?? "local://.kilo/memory.json",
        lastPing: Date.now(),
        latencyMs: latency,
        lastError: undefined,
      })
    } catch (err: unknown) {
      this.setConnection({
        status: "error",
        endpoint: this.storeFilePath ?? "local://.kilo/memory.json",
        lastPing: Date.now(),
        latencyMs: Date.now() - started,
        lastError: err instanceof Error ? err.message : "Unknown error",
      })
    }

    return this.getConnection()
  }

  // ─── Memory Write ────────────────────────────────────

  writeMemory(params: {
    summary: string
    content: string
    factType: MemoryEntry["factType"]
    scope: MemoryEntry["scope"]
    project?: string
    agent?: string
  }): MemoryEntry {
    // ── Write validation ──
    if (!params.summary || !params.summary.trim()) {
      const msg = "[Kilo Memory] Write rejected: summary must be non-empty"
      console.error(msg)
      throw new Error(msg)
    }
    if (!VALID_FACT_TYPES.has(params.factType)) {
      const msg = `[Kilo Memory] Write rejected: invalid factType "${params.factType}". Must be one of: ${[...VALID_FACT_TYPES].join(", ")}`
      console.error(msg)
      throw new Error(msg)
    }
    if (!VALID_SCOPES.has(params.scope)) {
      const msg = `[Kilo Memory] Write rejected: invalid scope "${params.scope}". Must be one of: ${[...VALID_SCOPES].join(", ")}`
      console.error(msg)
      throw new Error(msg)
    }

    // ── Memory size limit: evict oldest entry if at capacity ──
    if (this.store.entries.length >= this.maxMemoryEntries) {
      let oldestIdx = 0
      for (let i = 1; i < this.store.entries.length; i++) {
        if (this.store.entries[i].timestamp < this.store.entries[oldestIdx].timestamp) {
          oldestIdx = i
        }
      }
      const evicted = this.store.entries.splice(oldestIdx, 1)[0]
      console.warn(`[Kilo Memory] Memory limit reached (${this.maxMemoryEntries}). Evicted oldest entry: ${evicted.id}`)
    }

    const project = params.project ?? this.getWorkspaceName()
    const entry: MemoryEntry = {
      id: this.generateId(),
      project,
      scope: params.scope,
      factType: params.factType,
      summary: params.summary,
      content: params.content || params.summary,
      traceRef: `wr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      agent: params.agent,
    }

    this.store.entries.push(entry)

    this.store.writeHistory.unshift({
      entryId: entry.id,
      summary: entry.summary,
      factType: entry.factType,
      project: entry.project,
      scope: entry.scope,
      traceRef: entry.traceRef,
      timestamp: entry.timestamp,
    })

    // Cap history at 500 entries
    if (this.store.writeHistory.length > 500) {
      this.store.writeHistory = this.store.writeHistory.slice(0, 500)
    }

    this.scheduleSave()
    this._onMemoryWritten.fire(entry)
    return entry
  }

  // ─── Memory Recall with TF-IDF ──────────────────────

  recall(query: string, options?: { project?: string; scope?: MemoryEntry["scope"]; factType?: MemoryEntry["factType"]; limit?: number; projectOnly?: boolean }): RecallResult {
    const project = options?.project ?? this.getWorkspaceName()
    const limit = options?.limit ?? 20
    const projectOnly = options?.projectOnly ?? true

    if (!query.trim()) {
      return { query, project, results: [], status: "empty", timestamp: Date.now() }
    }

    try {
      // Filter candidates by scope/project/factType with cross-project isolation
      let candidates = this.store.entries.filter((e) => {
        if (options?.scope && e.scope !== options.scope) return false
        if (options?.factType && e.factType !== options.factType) return false
        if (projectOnly) {
          // Only return memories matching the given project
          if (e.scope === "project" && e.project !== project) return false
          if (e.scope === "task" && e.project !== project) return false
        }
        // Global entries are always visible regardless of projectOnly
        return true
      })

      if (candidates.length === 0) {
        return { query, project, results: [], status: "empty", timestamp: Date.now() }
      }

      const queryTokens = tokenize(query)
      const queryTF = computeTF(queryTokens)

      // Build corpus for IDF
      const corpus = candidates.map((e) => tokenize(`${e.summary} ${e.content}`))

      // Compute TF-IDF weighted vectors
      const queryVector: TermFrequencies = {}
      for (const term of Object.keys(queryTF)) {
        queryVector[term] = queryTF[term] * computeIDF([queryTokens, ...corpus], term)
      }

      const scored = candidates.map((entry, idx) => {
        const docTokens = corpus[idx]
        const docTF = computeTF(docTokens)

        // TF-IDF weighted document vector
        const docVector: TermFrequencies = {}
        for (const term of Object.keys(docTF)) {
          docVector[term] = docTF[term] * computeIDF([queryTokens, ...corpus], term)
        }

        // Cosine similarity
        const tfidfScore = cosineSimilarity(queryVector, docVector)

        // Exact substring match bonus
        const lowerSummary = entry.summary.toLowerCase()
        const lowerContent = entry.content.toLowerCase()
        const lowerQuery = query.toLowerCase()
        const exactMatchBonus = lowerSummary.includes(lowerQuery)
          ? 0.3
          : lowerContent.includes(lowerQuery)
            ? 0.2
            : 0

        // Term overlap ratio
        const matchingTerms = queryTokens.filter((t) => docTokens.includes(t))
        const overlapRatio = queryTokens.length > 0 ? matchingTerms.length / queryTokens.length : 0
        const overlapBonus = overlapRatio * 0.15

        // Recency bias (slight, max 0.05 for entries from last hour)
        const ageMs = Date.now() - entry.timestamp
        const recencyBonus = Math.max(0, 0.05 * (1 - ageMs / (3600_000 * 24 * 30)))

        const relevanceScore = Math.min(1.0, tfidfScore + exactMatchBonus + overlapBonus + recencyBonus)

        // Build human-readable match reason
        const reasons: string[] = []
        if (tfidfScore > 0) reasons.push(`TF-IDF cosine: ${(tfidfScore * 100).toFixed(1)}%`)
        if (exactMatchBonus > 0) reasons.push(`exact substring match in ${lowerSummary.includes(lowerQuery) ? "summary" : "content"}`)
        if (matchingTerms.length > 0) reasons.push(`term overlap: ${matchingTerms.join(", ")} (${(overlapRatio * 100).toFixed(0)}%)`)
        if (recencyBonus > 0.001) reasons.push(`recency boost: +${(recencyBonus * 100).toFixed(1)}%`)

        return {
          ...entry,
          relevanceScore: Math.round(relevanceScore * 1000) / 1000,
          matchReason: reasons.join("; ") || "low relevance",
          ...(!projectOnly ? { crossProject: entry.project !== project } : {}),
        }
      })

      // Filter out zero-relevance, sort descending, limit
      const results = scored
        .filter((r) => r.relevanceScore > 0.01)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit)

      const result: RecallResult = {
        query,
        project,
        results,
        status: results.length > 0 ? "success" : "empty",
        timestamp: Date.now(),
      }

      this._onRecallCompleted.fire(result)
      return result
    } catch (err: unknown) {
      const result: RecallResult = {
        query,
        project,
        results: [],
        status: "failed",
        timestamp: Date.now(),
      }
      this._onRecallCompleted.fire(result)
      return result
    }
  }

  // ─── Write History ───────────────────────────────────

  getWriteHistory(options?: {
    factType?: MemoryEntry["factType"]
    project?: string
    scope?: MemoryEntry["scope"]
    limit?: number
    offset?: number
  }): WriteHistoryRecord[] {
    let records = [...this.store.writeHistory]

    if (options?.factType) {
      records = records.filter((r) => r.factType === options.factType)
    }
    if (options?.project) {
      records = records.filter((r) => r.project === options.project)
    }
    if (options?.scope) {
      records = records.filter((r) => r.scope === options.scope)
    }

    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 100

    return records.slice(offset, offset + limit)
  }

  // ─── Cross-Agent Permissions ─────────────────────────

  getPermissions(): AgentPermission[] {
    return this.store.permissions.map((p) => ({
      agentId: p.agentId,
      scopes: { ...p.scopes },
    }))
  }

  setPermission(agentId: string, scope: "global" | "project" | "task", allowed: boolean): AgentPermission {
    let perm = this.store.permissions.find((p) => p.agentId === agentId)
    if (!perm) {
      perm = { agentId, scopes: { global: true, project: true, task: true } }
      this.store.permissions.push(perm)
    }
    perm.scopes[scope] = allowed
    this.scheduleSave()
    this._onPermissionChanged.fire({ agentId: perm.agentId, scopes: { ...perm.scopes } })
    return { agentId: perm.agentId, scopes: { ...perm.scopes } }
  }

  ensureAgent(agentId: string): AgentPermission {
    let perm = this.store.permissions.find((p) => p.agentId === agentId)
    if (!perm) {
      perm = { agentId, scopes: { global: true, project: true, task: true } }
      this.store.permissions.push(perm)
      this.scheduleSave()
    }
    return { agentId: perm.agentId, scopes: { ...perm.scopes } }
  }

  // ─── Status ──────────────────────────────────────────

  getStatus(): {
    connection: MemoryConnection
    connectionHistory: ConnectionEvent[]
    entryCount: number
    writeHistoryCount: number
    permissions: AgentPermission[]
  } {
    return {
      connection: this.getConnection(),
      connectionHistory: this.getConnectionHistory(),
      entryCount: this.store.entries.length,
      writeHistoryCount: this.store.writeHistory.length,
      permissions: this.getPermissions(),
    }
  }

  // ─── Dispose ─────────────────────────────────────────

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = undefined
    }
    // Flush any pending writes
    if (this.savePending) {
      this.flushSave()
    }
    this._onConnectionChanged.dispose()
    this._onMemoryWritten.dispose()
    this._onRecallCompleted.dispose()
    this._onPermissionChanged.dispose()
  }

  // ─── Private ─────────────────────────────────────────

  /**
   * Check whether an agent has permission to access a memory scope within a project.
   * - "task" scope: only the originating agent can access
   * - "project" scope: any agent with project permission can access
   * - "global" scope: any agent with global permission can access
   */
  private checkPermission(agentId: string, project: string, scope: MemoryEntry["scope"]): boolean {
    const perm = this.store.permissions.find((p) => p.agentId === agentId)
    if (!perm) {
      // Unknown agent: deny access
      return false
    }

    switch (scope) {
      case "task":
        // Only the originating agent can access task-scoped memories
        return perm.scopes.task
      case "project":
        // Any agent with project permission can access
        return perm.scopes.project
      case "global":
        // Any agent with global permission can access
        return perm.scopes.global
      default:
        return false
    }
  }

  private resolveStorePath(): void {
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      const kiloDir = path.join(folders[0].uri.fsPath, ".kilo")
      this.storeFilePath = path.join(kiloDir, "memory.json")
      this.connection.endpoint = this.storeFilePath
    } else {
      // Fallback to extension global storage
      const globalDir = this.ctx.globalStorageUri.fsPath
      this.storeFilePath = path.join(globalDir, "memory.json")
      this.connection.endpoint = this.storeFilePath
    }
  }

  private loadStore(): void {
    if (!this.storeFilePath) {
      this.setConnection({
        ...this.connection,
        status: "error",
        lastPing: Date.now(),
        lastError: "No store file path resolved",
      })
      return
    }

    try {
      if (fs.existsSync(this.storeFilePath)) {
        const raw = fs.readFileSync(this.storeFilePath, "utf-8")
        const parsed = JSON.parse(raw)
        this.store = {
          entries: Array.isArray(parsed.entries) ? parsed.entries : [],
          writeHistory: Array.isArray(parsed.writeHistory) ? parsed.writeHistory : [],
          permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [],
        }
      } else {
        this.store = { entries: [], writeHistory: [], permissions: [] }
      }
      this.setConnection({
        status: "connected",
        endpoint: this.storeFilePath,
        lastPing: Date.now(),
        latencyMs: 0,
        lastError: undefined,
      })
    } catch (err: unknown) {
      this.store = { entries: [], writeHistory: [], permissions: [] }
      this.setConnection({
        status: "error",
        endpoint: this.storeFilePath,
        lastPing: Date.now(),
        lastError: err instanceof Error ? err.message : "Failed to load memory store",
      })
    }
  }

  private flushSave(): void {
    this.savePending = false
    if (!this.storeFilePath) return

    try {
      const dir = path.dirname(this.storeFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.storeFilePath, JSON.stringify(this.store, null, 2), "utf-8")
    } catch (err: unknown) {
      console.error("[Kilo Memory] Failed to save store:", err)
    }
  }

  private scheduleSave(): void {
    this.savePending = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.flushSave()
    }, 500)
  }

  private setConnection(conn: MemoryConnection): void {
    const prev = this.connection.status
    this.connection = conn

    // Track connection events (keep last 10)
    if (prev !== conn.status) {
      this.connectionHistory.push({
        type: conn.status,
        timestamp: Date.now(),
        endpoint: conn.endpoint,
        error: conn.lastError,
      })
      if (this.connectionHistory.length > 10) {
        this.connectionHistory = this.connectionHistory.slice(-10)
      }
    }

    this._onConnectionChanged.fire(conn)
  }

  private startPingLoop(): void {
    // Ping every 30 seconds to verify local store is accessible
    this.pingTimer = setInterval(() => {
      if (!this.storeFilePath) return
      const started = Date.now()
      try {
        const accessible = fs.existsSync(this.storeFilePath)
          || fs.existsSync(path.dirname(this.storeFilePath))
        const latency = Date.now() - started
        if (accessible && this.connection.status !== "connected") {
          this.setConnection({
            status: "connected",
            endpoint: this.storeFilePath,
            lastPing: Date.now(),
            latencyMs: latency,
            lastError: undefined,
          })
        } else if (this.connection.status === "connected") {
          // Just update ping time
          this.connection.lastPing = Date.now()
          this.connection.latencyMs = latency
        }
      } catch {
        if (this.connection.status !== "error") {
          this.setConnection({
            status: "error",
            endpoint: this.storeFilePath!,
            lastPing: Date.now(),
            lastError: "Store file inaccessible",
          })
        }
      }
    }, 30_000)
  }

  private getWorkspaceName(): string {
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      return folders[0].name
    }
    return "unknown"
  }

  private generateId(): string {
    const ts = Date.now().toString(36)
    const rand = Math.random().toString(36).slice(2, 10)
    return `mem-${ts}-${rand}`
  }
}
