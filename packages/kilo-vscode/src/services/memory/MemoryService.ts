import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { KiloLogger } from "../KiloLogger"

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

export interface CrossAgentRecallRequest {
  requestingAgent: string
  targetAgent?: string
  query: string
  projectScope?: string
  includeGlobal: boolean
}

export interface AgentRecallTrace {
  requestingAgent: string
  query: string
  entriesSearched: number
  entriesReturned: number
  permissionChecks: Array<{ scope: string; granted: boolean }>
  timestamp: number
}

export type MemoryErrorCode =
  | "CONNECTION_FAILED"
  | "WRITE_REJECTED"
  | "RECALL_EMPTY"
  | "PERMISSION_DENIED"
  | "QUOTA_EXCEEDED"
  | "INVALID_SCOPE"
  | "TIMEOUT"

export class MemoryError extends Error {
  constructor(
    message: string,
    public readonly code: MemoryErrorCode,
  ) {
    super(message)
    this.name = "MemoryError"
  }
}

export interface MemoryHealthCheck {
  status: "healthy" | "degraded" | "unavailable"
  lastSuccessfulWrite: number | null
  lastSuccessfulRecall: number | null
  errorRate: number
  consecutiveFailures: number
}

export interface MemoryDiagnosticResult {
  connectivity: boolean
  writeTest: boolean
  recallTest: boolean
  latencyMs: number
  errors: string[]
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
  private readonly log = KiloLogger.for("MemoryService")
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

  // ── Cross-agent recall traces ──
  private recallTraces: AgentRecallTrace[] = []
  private readonly maxRecallTraces = 100

  // ── Health tracking ──
  private lastSuccessfulWrite: number | null = null
  private lastSuccessfulRecall: number | null = null
  private operationResults: Array<{ success: boolean; timestamp: number }> = []
  private consecutiveFailures = 0
  private readonly autoReconnectThreshold = 3

  private readonly _onConnectionChanged = new vscode.EventEmitter<MemoryConnection>()
  readonly onConnectionChanged = this._onConnectionChanged.event

  private readonly _onMemoryWritten = new vscode.EventEmitter<MemoryEntry>()
  readonly onMemoryWritten = this._onMemoryWritten.event

  private readonly _onRecallCompleted = new vscode.EventEmitter<RecallResult>()
  readonly onRecallCompleted = this._onRecallCompleted.event

  private readonly _onPermissionChanged = new vscode.EventEmitter<AgentPermission>()
  readonly onPermissionChanged = this._onPermissionChanged.event

  private readonly _onHealthChanged = new vscode.EventEmitter<MemoryHealthCheck>()
  readonly onHealthChanged = this._onHealthChanged.event

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.resolveStorePath()
    this.loadStore()
    this.startPingLoop()
    this.log.info("MemoryService initialized")

    // Auto-attach to Hermes/Shiba endpoint after a short delay so activation is not blocked.
    setTimeout(() => {
      void this.autoConnect().catch((err: unknown) => {
        this.log.error("autoConnect failed", err)
      })
    }, 500)
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

  /**
   * Discover and attach to a Memory (Hermes/Shiba) endpoint automatically.
   *
   * Resolution order:
   *   1. `<workspaceRoot>/.kilo/hermes.json`
   *   2. `<workspaceRoot>/.kilo/shiba.json`
   *   3. `~/.kilo/hermes.json`
   *   4. `~/.kilo/shiba.json`
   *   5. Default: http://localhost:7002
   *
   * Each config file may contain an `endpoint` (or `url`) string. The resolved
   * endpoint is probed with a `GET /health` (and a bare `GET /` fallback) with
   * a 2-second timeout. If the probe succeeds the connection transitions to
   * "connected"; otherwise it is left in its previous state and the error is
   * recorded.
   */
  async autoConnect(): Promise<{ connected: boolean; endpoint: string; error?: string }> {
    const defaultEndpoint = "http://localhost:7002"
    let endpoint = defaultEndpoint
    let source = "default"

    try {
      const candidates = this.buildConfigCandidatePaths()
      for (const candidate of candidates) {
        try {
          if (!fs.existsSync(candidate)) continue
          const raw = fs.readFileSync(candidate, "utf-8")
          const parsed = JSON.parse(raw) as { endpoint?: unknown; url?: unknown }
          const configured =
            typeof parsed.endpoint === "string"
              ? parsed.endpoint
              : typeof parsed.url === "string"
                ? parsed.url
                : undefined
          if (configured && configured.trim().length > 0) {
            endpoint = configured.trim()
            source = candidate
            this.log.info("autoConnect: discovered endpoint in config", { path: candidate, endpoint })
            break
          }
        } catch (err: unknown) {
          this.log.warn("autoConnect: failed to parse memory config", {
            path: candidate,
            error: err instanceof Error ? err.message : String(err),
          })
          // Try the next candidate
        }
      }

      if (source === "default") {
        this.log.info("autoConnect: no hermes.json/shiba.json found, using default endpoint", { endpoint })
      }

      const started = Date.now()
      const probe = await this.probeEndpoint(endpoint, 2000)
      const latencyMs = Date.now() - started

      if (probe.ok) {
        this.setConnection({
          status: "connected",
          endpoint,
          lastPing: Date.now(),
          latencyMs,
          lastError: undefined,
        })
        this.log.info("autoConnect: connected to memory endpoint", { endpoint, latencyMs, source })
        return { connected: true, endpoint }
      }

      const errorMsg = probe.error ?? "Health check failed"
      this.log.warn("autoConnect: health check failed, leaving connection state unchanged", {
        endpoint,
        error: errorMsg,
        latencyMs,
      })
      return { connected: false, endpoint, error: errorMsg }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.error("autoConnect: unexpected error", { endpoint, error: errorMsg })
      return { connected: false, endpoint, error: errorMsg }
    }
  }

  /** Build an ordered list of candidate paths for hermes.json / shiba.json. */
  private buildConfigCandidatePaths(): string[] {
    const candidates: string[] = []
    const fileNames = ["hermes.json", "shiba.json"]

    try {
      const folders = vscode.workspace.workspaceFolders
      if (folders && folders.length > 0) {
        const wsRoot = folders[0].uri.fsPath
        for (const name of fileNames) {
          candidates.push(path.join(wsRoot, ".kilo", name))
        }
      }
    } catch (err: unknown) {
      this.log.warn("autoConnect: failed to resolve workspace candidates", err)
    }

    try {
      const home = os.homedir()
      if (home) {
        for (const name of fileNames) {
          candidates.push(path.join(home, ".kilo", name))
        }
      }
    } catch (err: unknown) {
      this.log.warn("autoConnect: failed to resolve home candidates", err)
    }

    return candidates
  }

  /** Probe an HTTP endpoint for a health check. Resolves with ok=false on any failure. */
  private async probeEndpoint(endpoint: string, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
    // Normalize endpoint
    const base = endpoint.replace(/\/$/, "")
    const healthUrl = `${base}/health`

    const tryOne = async (url: string): Promise<{ ok: boolean; error?: string }> => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, { method: "GET", signal: controller.signal })
        return { ok: res.ok }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg }
      } finally {
        clearTimeout(timer)
      }
    }

    try {
      const first = await tryOne(healthUrl)
      if (first.ok) return first
      // Fall back to the root URL in case /health is not implemented
      const second = await tryOne(base)
      if (second.ok) return second
      return { ok: false, error: first.error ?? second.error ?? "Endpoint unreachable" }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
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
      const msg = "Write rejected: summary must be non-empty"
      this.log.error(msg)
      throw new Error(msg)
    }
    if (!VALID_FACT_TYPES.has(params.factType)) {
      const msg = `Write rejected: invalid factType "${params.factType}". Must be one of: ${[...VALID_FACT_TYPES].join(", ")}`
      this.log.error(msg)
      throw new Error(msg)
    }
    if (!VALID_SCOPES.has(params.scope)) {
      const msg = `Write rejected: invalid scope "${params.scope}". Must be one of: ${[...VALID_SCOPES].join(", ")}`
      this.log.error(msg)
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
      this.log.warn(`Memory limit reached (${this.maxMemoryEntries}). Evicted oldest entry: ${evicted.id}`)
    }

    const project = params.project ?? this.getWorkspaceName()
    this.log.info("Memory write", { key: params.summary, scope: params.scope })
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
    this.lastSuccessfulWrite = Date.now()
    this.recordOperation(true)
    this._onMemoryWritten.fire(entry)
    return entry
  }

  // ─── Memory Recall with TF-IDF ──────────────────────

  recall(query: string, options?: { project?: string; scope?: MemoryEntry["scope"]; factType?: MemoryEntry["factType"]; limit?: number; projectOnly?: boolean }): RecallResult {
    const project = options?.project ?? this.getWorkspaceName()
    const limit = options?.limit ?? 20
    const projectOnly = options?.projectOnly ?? true

    this.log.info("Memory recall", { query })

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

      this.lastSuccessfulRecall = Date.now()
      this.recordOperation(true)
      this.log.debug("Recall results", { query, resultCount: result.results.length, status: result.status, results: result.results })
      this._onRecallCompleted.fire(result)
      return result
    } catch (err: unknown) {
      this.recordOperation(false)
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
    this.log.info("Permission changed", { agentId, scope, allowed })
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

  // ─── Cross-Agent Recall Workflow ──────────────────────

  registerAgent(agentId: string, permissions: AgentPermission): void {
    const existing = this.store.permissions.findIndex((p) => p.agentId === agentId)
    const perm: AgentPermission = {
      agentId,
      scopes: { ...permissions.scopes },
    }
    if (existing >= 0) {
      this.store.permissions[existing] = perm
      this.log.info("Agent permissions updated", { agentId, scopes: perm.scopes })
    } else {
      this.store.permissions.push(perm)
      this.log.info("Agent registered", { agentId, scopes: perm.scopes })
    }
    this.scheduleSave()
    this._onPermissionChanged.fire({ agentId: perm.agentId, scopes: { ...perm.scopes } })
  }

  getRegisteredAgents(): Array<{ agentId: string; permissions: AgentPermission }> {
    return this.store.permissions.map((p) => ({
      agentId: p.agentId,
      permissions: { agentId: p.agentId, scopes: { ...p.scopes } },
    }))
  }

  crossAgentRecall(request: CrossAgentRecallRequest): RecallResult {
    const project = request.projectScope ?? this.getWorkspaceName()
    const permissionChecks: Array<{ scope: string; granted: boolean }> = []

    // Verify the requesting agent is registered
    const agentPerm = this.store.permissions.find((p) => p.agentId === request.requestingAgent)
    if (!agentPerm) {
      const trace: AgentRecallTrace = {
        requestingAgent: request.requestingAgent,
        query: request.query,
        entriesSearched: 0,
        entriesReturned: 0,
        permissionChecks: [{ scope: "agent_registration", granted: false }],
        timestamp: Date.now(),
      }
      this.addRecallTrace(trace)
      this.recordOperation(false)
      throw new MemoryError(
        `Agent "${request.requestingAgent}" is not registered`,
        "PERMISSION_DENIED",
      )
    }

    if (!request.query.trim()) {
      const result: RecallResult = { query: request.query, project, results: [], status: "empty", timestamp: Date.now() }
      const trace: AgentRecallTrace = {
        requestingAgent: request.requestingAgent,
        query: request.query,
        entriesSearched: 0,
        entriesReturned: 0,
        permissionChecks: [],
        timestamp: Date.now(),
      }
      this.addRecallTrace(trace)
      return result
    }

    // Filter candidates based on cross-agent permissions
    const candidates = this.store.entries.filter((entry) => {
      // If a target agent is specified, only include entries from that agent
      if (request.targetAgent && entry.agent !== request.targetAgent) {
        return false
      }

      // Check scope-level permissions for the requesting agent
      const scopeGranted = this.checkPermission(request.requestingAgent, project, entry.scope)
      permissionChecks.push({ scope: `${entry.scope}:${entry.project}`, granted: scopeGranted })

      if (!scopeGranted) return false

      // Project isolation: project/task scoped entries must match projectScope
      if (entry.scope === "project" || entry.scope === "task") {
        if (entry.project !== project) return false
      }

      // Global entries are only included if includeGlobal is true
      if (entry.scope === "global" && !request.includeGlobal) {
        return false
      }

      return true
    })

    // Use the existing recall logic for scoring
    const result = this.recall(request.query, {
      project,
      projectOnly: !request.includeGlobal,
    })

    // Filter the recall results to only include entries the agent has permission to see
    const candidateIds = new Set(candidates.map((c) => c.id))
    const filteredResults = result.results.filter((r) => candidateIds.has(r.id))

    const finalResult: RecallResult = {
      query: request.query,
      project,
      results: filteredResults,
      status: filteredResults.length > 0 ? "success" : "empty",
      timestamp: Date.now(),
    }

    const trace: AgentRecallTrace = {
      requestingAgent: request.requestingAgent,
      query: request.query,
      entriesSearched: candidates.length,
      entriesReturned: filteredResults.length,
      permissionChecks,
      timestamp: Date.now(),
    }
    this.addRecallTrace(trace)
    this.recordOperation(true)

    return finalResult
  }

  getAgentRecallTraces(): AgentRecallTrace[] {
    return [...this.recallTraces]
  }

  // ─── Health & Diagnostics ───────────────────────────

  getHealthCheck(): MemoryHealthCheck {
    // Compute error rate from recent operations (last 100)
    const recentOps = this.operationResults.slice(-100)
    const errorRate = recentOps.length > 0
      ? recentOps.filter((op) => !op.success).length / recentOps.length
      : 0

    let status: MemoryHealthCheck["status"]
    if (this.connection.status === "error" || this.consecutiveFailures >= this.autoReconnectThreshold) {
      status = "unavailable"
    } else if (errorRate > 0.1 || this.consecutiveFailures > 0) {
      status = "degraded"
    } else {
      status = "healthy"
    }

    return {
      status,
      lastSuccessfulWrite: this.lastSuccessfulWrite,
      lastSuccessfulRecall: this.lastSuccessfulRecall,
      errorRate: Math.round(errorRate * 1000) / 1000,
      consecutiveFailures: this.consecutiveFailures,
    }
  }

  async runDiagnostics(): Promise<MemoryDiagnosticResult> {
    const errors: string[] = []
    const started = Date.now()

    // Connectivity test
    let connectivity = false
    try {
      if (this.storeFilePath) {
        const dirExists = fs.existsSync(path.dirname(this.storeFilePath))
        connectivity = dirExists
        if (!dirExists) {
          errors.push("Store directory does not exist")
        }
      } else {
        errors.push("No store file path resolved")
      }
    } catch (err: unknown) {
      errors.push(`Connectivity check failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    }

    // Write test
    let writeTest = false
    try {
      const testEntry = this.writeMemory({
        summary: "__diagnostic_test__",
        content: "__diagnostic_test_content__",
        factType: "recall",
        scope: "task",
        project: "__diagnostics__",
      })
      // Clean up the test entry
      const idx = this.store.entries.findIndex((e) => e.id === testEntry.id)
      if (idx >= 0) {
        this.store.entries.splice(idx, 1)
      }
      // Also clean up the write history record
      const histIdx = this.store.writeHistory.findIndex((h) => h.entryId === testEntry.id)
      if (histIdx >= 0) {
        this.store.writeHistory.splice(histIdx, 1)
      }
      this.scheduleSave()
      writeTest = true
    } catch (err: unknown) {
      errors.push(`Write test failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    }

    // Recall test
    let recallTest = false
    try {
      const result = this.recall("diagnostic test query", { project: "__diagnostics__" })
      // We consider recall working even if results are empty, as long as it doesn't throw
      recallTest = result.status !== "failed"
    } catch (err: unknown) {
      errors.push(`Recall test failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    }

    const latencyMs = Date.now() - started

    return {
      connectivity,
      writeTest,
      recallTest,
      latencyMs,
      errors,
    }
  }

  // ─── Status ──────────────────────────────────────────

  getStatus(): {
    connection: MemoryConnection
    connectionHistory: ConnectionEvent[]
    entryCount: number
    writeHistoryCount: number
    permissions: AgentPermission[]
    health: MemoryHealthCheck
  } {
    return {
      connection: this.getConnection(),
      connectionHistory: this.getConnectionHistory(),
      entryCount: this.store.entries.length,
      writeHistoryCount: this.store.writeHistory.length,
      permissions: this.getPermissions(),
      health: this.getHealthCheck(),
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
    this._onHealthChanged.dispose()
  }

  // ─── Private ─────────────────────────────────────────

  private addRecallTrace(trace: AgentRecallTrace): void {
    this.recallTraces.push(trace)
    if (this.recallTraces.length > this.maxRecallTraces) {
      this.recallTraces = this.recallTraces.slice(-this.maxRecallTraces)
    }
  }

  private recordOperation(success: boolean): void {
    this.operationResults.push({ success, timestamp: Date.now() })
    // Keep last 200 to compute rolling error rate
    if (this.operationResults.length > 200) {
      this.operationResults = this.operationResults.slice(-200)
    }

    const prevHealth = this.getHealthCheck()

    if (success) {
      this.consecutiveFailures = 0
    } else {
      this.consecutiveFailures++
      // Auto-reconnect after consecutive failures threshold
      if (this.consecutiveFailures >= this.autoReconnectThreshold) {
        this.log.warn(`${this.consecutiveFailures} consecutive failures detected, triggering auto-reconnect`)
        void this.reconnect()
      }
    }

    const newHealth = this.getHealthCheck()
    if (prevHealth.status !== newHealth.status) {
      this._onHealthChanged.fire(newHealth)
    }
  }

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
      this.log.error("Failed to save store", err)
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
      this.log.info(`Connection state changed: ${prev} -> ${conn.status}`, { endpoint: conn.endpoint, latencyMs: conn.latencyMs, error: conn.lastError })
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
