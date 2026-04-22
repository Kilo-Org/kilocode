import { Component, createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { useVSCode } from "../../context/vscode"

// ─── Types ───────────────────────────────────────────────

interface MemoryEntry {
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

interface RecallResultEntry extends MemoryEntry {
  relevanceScore: number
  matchReason: string
}

interface RecallResult {
  query: string
  project: string
  results: RecallResultEntry[]
  status: "success" | "empty" | "failed"
  timestamp: number
}

interface MemoryConnection {
  status: "connected" | "disconnected" | "error"
  endpoint: string
  lastPing?: number
  latencyMs?: number
  lastError?: string
}

interface ConnectionEvent {
  type: "connected" | "disconnected" | "error"
  timestamp: number
  endpoint: string
  error?: string
}

interface WriteHistoryRecord {
  entryId: string
  summary: string
  factType: MemoryEntry["factType"]
  project: string
  scope: MemoryEntry["scope"]
  traceRef: string
  timestamp: number
}

interface AgentPermission {
  agentId: string
  scopes: {
    global: boolean
    project: boolean
    task: boolean
  }
}

interface AgentRecallTrace {
  requestingAgent: string
  query: string
  entriesSearched: number
  entriesReturned: number
  permissionChecks: Array<{ scope: string; granted: boolean }>
  timestamp: number
}

interface MemoryHealthCheck {
  status: "healthy" | "degraded" | "unavailable"
  lastSuccessfulWrite: number | null
  lastSuccessfulRecall: number | null
  errorRate: number
  consecutiveFailures: number
}

interface MemoryDiagnosticResult {
  connectivity: boolean
  writeTest: boolean
  recallTest: boolean
  latencyMs: number
  errors: string[]
}

interface MemoryStatusPayload {
  connection: MemoryConnection
  connectionHistory: ConnectionEvent[]
  entryCount: number
  writeHistoryCount: number
  permissions: AgentPermission[]
  health: MemoryHealthCheck
}

// ─── Style Constants ─────────────────────────────────────

const inputStyle: Record<string, string> = {
  width: "100%",
  padding: "4px 8px",
  border: "1px solid var(--vscode-input-border)",
  background: "var(--vscode-input-background)",
  color: "var(--vscode-input-foreground)",
  "border-radius": "2px",
  "font-size": "13px",
  "box-sizing": "border-box",
}

const textareaStyle: Record<string, string> = {
  ...inputStyle,
  "min-height": "60px",
  resize: "vertical",
  "font-family": "inherit",
}

const buttonStyle: Record<string, string> = {
  padding: "4px 12px",
  border: "none",
  background: "var(--vscode-button-background)",
  color: "var(--vscode-button-foreground)",
  "border-radius": "2px",
  "font-size": "12px",
  cursor: "pointer",
  "white-space": "nowrap",
}

const secondaryButtonStyle: Record<string, string> = {
  ...buttonStyle,
  background: "var(--vscode-button-secondaryBackground)",
  color: "var(--vscode-button-secondaryForeground)",
}

const cardStyle: Record<string, string> = {
  border: "1px solid var(--vscode-panel-border)",
  "border-radius": "4px",
  "margin-bottom": "12px",
  overflow: "hidden",
}

const sectionHeaderStyle: Record<string, string> = {
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "8px 12px",
  cursor: "pointer",
  "user-select": "none",
  "font-weight": "600",
  "font-size": "13px",
  background: "var(--vscode-sideBarSectionHeader-background)",
  color: "var(--vscode-sideBarSectionHeader-foreground)",
}

const sectionContentStyle: Record<string, string> = {
  padding: "8px 12px",
}

const badgeColors: Record<string, { bg: string; fg: string }> = {
  contract: { bg: "var(--vscode-charts-blue)", fg: "#fff" },
  fix: { bg: "var(--vscode-charts-red)", fg: "#fff" },
  recall: { bg: "var(--vscode-charts-green)", fg: "#fff" },
  decision: { bg: "var(--vscode-charts-yellow)", fg: "#000" },
}

const statusColors: Record<string, string> = {
  connected: "var(--vscode-testing-iconPassed)",
  disconnected: "var(--vscode-disabledForeground)",
  error: "var(--vscode-testing-iconFailed)",
}

const healthStatusColors: Record<string, string> = {
  healthy: "var(--vscode-testing-iconPassed)",
  degraded: "var(--vscode-charts-yellow)",
  unavailable: "var(--vscode-testing-iconFailed)",
}

// ─── Helpers ─────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return "--"
  return `${ms}ms`
}

function factTypeBadge(factType: string) {
  const colors = badgeColors[factType] ?? { bg: "var(--vscode-badge-background)", fg: "var(--vscode-badge-foreground)" }
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        "border-radius": "8px",
        "font-size": "11px",
        "font-weight": "500",
        background: colors.bg,
        color: colors.fg,
        "text-transform": "uppercase",
        "letter-spacing": "0.3px",
      }}
    >
      {factType}
    </span>
  )
}

function scopeBadge(scope: string) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        "border-radius": "8px",
        "font-size": "10px",
        border: "1px solid var(--vscode-panel-border)",
        color: "var(--vscode-descriptionForeground)",
        "text-transform": "uppercase",
      }}
    >
      {scope}
    </span>
  )
}

function relevanceBar(score: number) {
  const pct = Math.round(score * 100)
  const barColor =
    pct >= 70 ? "var(--vscode-testing-iconPassed)" :
    pct >= 40 ? "var(--vscode-charts-yellow)" :
    "var(--vscode-charts-orange)"
  return (
    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
      <div
        style={{
          width: "60px",
          height: "4px",
          background: "var(--vscode-panel-border)",
          "border-radius": "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: barColor,
            "border-radius": "2px",
          }}
        />
      </div>
      <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
        {pct}%
      </span>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────

// eslint-disable-next-line complexity
const MemoryTab: Component = () => {
  const vscode = useVSCode()

  // ── Connection state ──
  const [connection, setConnection] = createSignal<MemoryConnection>({
    status: "disconnected",
    endpoint: "",
  })
  const [connectionHistory, setConnectionHistory] = createSignal<ConnectionEvent[]>([])
  const [reconnecting, setReconnecting] = createSignal(false)
  const [showConnectionHistory, setShowConnectionHistory] = createSignal(false)

  // ── Recall state ──
  const [recallQuery, setRecallQuery] = createSignal("")
  const [recallResults, setRecallResults] = createSignal<RecallResultEntry[]>([])
  const [recallStatus, setRecallStatus] = createSignal<"idle" | "loading" | "success" | "empty" | "failed">("idle")
  const [expandedRecallId, setExpandedRecallId] = createSignal<string | null>(null)

  // ── Write history state ──
  const [writeHistory, setWriteHistory] = createSignal<WriteHistoryRecord[]>([])
  const [historyFilterType, setHistoryFilterType] = createSignal<string>("all")
  const [historyFilterProject, setHistoryFilterProject] = createSignal<string>("all")
  const [historyFilterScope, setHistoryFilterScope] = createSignal<string>("all")
  const [showWriteForm, setShowWriteForm] = createSignal(false)
  const [writeSummary, setWriteSummary] = createSignal("")
  const [writeContent, setWriteContent] = createSignal("")
  const [writeFactType, setWriteFactType] = createSignal<MemoryEntry["factType"]>("recall")
  const [writeScope, setWriteScope] = createSignal<MemoryEntry["scope"]>("project")
  const [writeProject, setWriteProject] = createSignal("")

  // ── Cross-agent state ──
  const [permissions, setPermissions] = createSignal<AgentPermission[]>([])
  const [newAgentId, setNewAgentId] = createSignal("")

  // ── Health & diagnostics state ──
  const [health, setHealth] = createSignal<MemoryHealthCheck>({
    status: "healthy",
    lastSuccessfulWrite: null,
    lastSuccessfulRecall: null,
    errorRate: 0,
    consecutiveFailures: 0,
  })
  const [diagnosticResult, setDiagnosticResult] = createSignal<MemoryDiagnosticResult | null>(null)
  const [diagRunning, setDiagRunning] = createSignal(false)

  // ── Agent recall traces state ──
  const [recallTraces, setRecallTraces] = createSignal<AgentRecallTrace[]>([])
  const [expandedTraceIdx, setExpandedTraceIdx] = createSignal<number | null>(null)

  // ── Section collapse ──
  const [connectOpen, setConnectOpen] = createSignal(true)
  const [recallOpen, setRecallOpen] = createSignal(true)
  const [historyOpen, setHistoryOpen] = createSignal(true)
  const [agentOpen, setAgentOpen] = createSignal(true)
  const [healthOpen, setHealthOpen] = createSignal(false)
  const [tracesOpen, setTracesOpen] = createSignal(false)

  // ── Message handler ──
  const unsubscribe = vscode.onMessage((msg) => {
    switch (msg.type) {
      case "memoryStatusLoaded": {
        const payload = msg as unknown as { type: string } & MemoryStatusPayload
        setConnection(payload.connection)
        setConnectionHistory(payload.connectionHistory)
        setPermissions(payload.permissions)
        if (payload.health) {
          setHealth(payload.health)
        }
        setReconnecting(false)
        break
      }
      case "memoryRecallResult": {
        const result = msg as unknown as { type: string } & RecallResult
        setRecallResults(result.results)
        setRecallStatus(result.status === "success" ? "success" : result.status === "empty" ? "empty" : "failed")
        break
      }
      case "memoryHistoryLoaded": {
        const payload = msg as unknown as { type: string; records: WriteHistoryRecord[] }
        setWriteHistory(payload.records)
        break
      }
      case "memoryWriteResult": {
        const payload = msg as unknown as { type: string; success: boolean }
        if (payload.success) {
          setShowWriteForm(false)
          setWriteSummary("")
          setWriteContent("")
          // Refresh history
          requestHistory()
        }
        break
      }
      case "memoryConnectionChanged": {
        const payload = msg as unknown as { type: string; connection: MemoryConnection }
        setConnection(payload.connection)
        setReconnecting(false)
        break
      }
      case "memoryPermissionChanged": {
        const payload = msg as unknown as { type: string; permission: AgentPermission }
        setPermissions((prev) => {
          const idx = prev.findIndex((p) => p.agentId === payload.permission.agentId)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = payload.permission
            return next
          }
          return [...prev, payload.permission]
        })
        break
      }
      case "memoryHealthChanged": {
        const payload = msg as unknown as { type: string; health: MemoryHealthCheck }
        setHealth(payload.health)
        break
      }
      case "memoryDiagnosticResult": {
        const payload = msg as unknown as { type: string; result: MemoryDiagnosticResult }
        setDiagnosticResult(payload.result)
        setDiagRunning(false)
        break
      }
      case "memoryRecallTracesLoaded": {
        const payload = msg as unknown as { type: string; traces: AgentRecallTrace[] }
        setRecallTraces(payload.traces)
        break
      }
    }
  })

  onCleanup(unsubscribe)

  // ── Initial data request ──
  vscode.postMessage({ type: "memoryGetStatus" } as never)
  vscode.postMessage({ type: "memoryGetHistory" } as never)

  // ── Actions ──

  function doReconnect() {
    setReconnecting(true)
    vscode.postMessage({ type: "memoryReconnect" } as never)
  }

  function doRecall() {
    const q = recallQuery().trim()
    if (!q) return
    setRecallStatus("loading")
    setRecallResults([])
    vscode.postMessage({ type: "memoryRecall", query: q } as never)
  }

  function doRecallKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      doRecall()
    }
  }

  function requestHistory() {
    const filters: Record<string, string> = {}
    if (historyFilterType() !== "all") filters.factType = historyFilterType()
    if (historyFilterProject() !== "all") filters.project = historyFilterProject()
    if (historyFilterScope() !== "all") filters.scope = historyFilterScope()
    vscode.postMessage({ type: "memoryGetHistory", ...filters } as never)
  }

  function doWriteMemory() {
    const summary = writeSummary().trim()
    if (!summary) return
    vscode.postMessage({
      type: "memoryWrite",
      summary,
      content: writeContent().trim() || summary,
      factType: writeFactType(),
      scope: writeScope(),
      project: writeProject().trim() || undefined,
    } as never)
  }

  function doSetPermission(agentId: string, scope: "global" | "project" | "task", allowed: boolean) {
    vscode.postMessage({
      type: "memorySetPermission",
      agentId,
      scope,
      allowed,
    } as never)
  }

  function doAddAgent() {
    const id = newAgentId().trim()
    if (!id) return
    // Add with all permissions enabled by default
    doSetPermission(id, "global", true)
    doSetPermission(id, "project", true)
    doSetPermission(id, "task", true)
    setNewAgentId("")
  }

  function doRunDiagnostics() {
    setDiagRunning(true)
    setDiagnosticResult(null)
    vscode.postMessage({ type: "memoryRunDiagnostics" } as never)
  }

  function doLoadRecallTraces() {
    vscode.postMessage({ type: "memoryGetRecallTraces" } as never)
  }

  // Refresh history when filters change
  createEffect(() => {
    // Track all filter signals
    historyFilterType()
    historyFilterProject()
    historyFilterScope()
    requestHistory()
  })

  // Derive unique projects from write history for filter dropdown
  const uniqueProjects = () => {
    const projects = new Set(writeHistory().map((r) => r.project))
    return Array.from(projects).sort()
  }

  // Filtered write history (client-side for responsiveness)
  const filteredHistory = () => {
    let records = writeHistory()
    if (historyFilterType() !== "all") {
      records = records.filter((r) => r.factType === historyFilterType())
    }
    if (historyFilterProject() !== "all") {
      records = records.filter((r) => r.project === historyFilterProject())
    }
    if (historyFilterScope() !== "all") {
      records = records.filter((r) => r.scope === historyFilterScope())
    }
    return records
  }

  // ── Render ──

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>

      {/* ═══════════════════════════════════════════════════════
          Connection Status
          ═══════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <div
          style={sectionHeaderStyle}
          onClick={() => setConnectOpen(!connectOpen())}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span>{connectOpen() ? "\u25BC" : "\u25B6"}</span>
            <span>Shiba Connection</span>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                "border-radius": "50%",
                background: statusColors[connection().status] ?? statusColors.disconnected,
              }}
              title={connection().status}
            />
            <span style={{ "font-weight": "400", "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
              {connection().status}
            </span>
          </div>
          <button
            style={secondaryButtonStyle}
            disabled={reconnecting()}
            onClick={(e) => {
              e.stopPropagation()
              doReconnect()
            }}
          >
            {reconnecting() ? "Reconnecting..." : "Reconnect"}
          </button>
        </div>

        <Show when={connectOpen()}>
          <div style={sectionContentStyle}>
            {/* Connection details */}
            <div style={{ display: "grid", "grid-template-columns": "auto 1fr", gap: "4px 12px", "font-size": "12px", "margin-bottom": "8px" }}>
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Endpoint:</span>
              <span style={{ "word-break": "break-all", "font-family": "var(--vscode-editor-font-family)", "font-size": "11px" }}>
                {connection().endpoint || "--"}
              </span>
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Last Ping:</span>
              <span>{connection().lastPing ? formatTimestamp(connection().lastPing!) : "--"}</span>
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Latency:</span>
              <span>{formatLatency(connection().latencyMs)}</span>
              <Show when={connection().lastError}>
                <span style={{ color: "var(--vscode-errorForeground)" }}>Error:</span>
                <span style={{ color: "var(--vscode-errorForeground)" }}>{connection().lastError}</span>
              </Show>
            </div>

            {/* Connection history toggle */}
            <div
              style={{
                "font-size": "12px",
                color: "var(--vscode-textLink-foreground)",
                cursor: "pointer",
                "margin-bottom": "4px",
              }}
              onClick={() => setShowConnectionHistory(!showConnectionHistory())}
            >
              {showConnectionHistory() ? "\u25BC" : "\u25B6"} Connection History ({connectionHistory().length})
            </div>

            <Show when={showConnectionHistory()}>
              <div style={{ "max-height": "150px", "overflow-y": "auto", "font-size": "11px" }}>
                <Show
                  when={connectionHistory().length > 0}
                  fallback={
                    <div style={{ color: "var(--vscode-descriptionForeground)", padding: "4px 0" }}>
                      No connection events recorded.
                    </div>
                  }
                >
                  <For each={connectionHistory().slice().reverse()}>
                    {(evt) => (
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "8px",
                          padding: "2px 0",
                          "border-bottom": "1px solid var(--vscode-panel-border)",
                        }}
                      >
                        <span
                          style={{
                            width: "6px",
                            height: "6px",
                            "border-radius": "50%",
                            background: statusColors[evt.type] ?? statusColors.disconnected,
                            "flex-shrink": "0",
                          }}
                        />
                        <span style={{ color: "var(--vscode-descriptionForeground)", "min-width": "75px" }}>
                          {formatTimestamp(evt.timestamp)}
                        </span>
                        <span>{evt.type}</span>
                        <Show when={evt.error}>
                          <span style={{ color: "var(--vscode-errorForeground)" }}>
                            -- {evt.error}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* ═══════════════════════════════════════════════════════
          Recall Trace Panel
          ═══════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <div
          style={sectionHeaderStyle}
          onClick={() => setRecallOpen(!recallOpen())}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span>{recallOpen() ? "\u25BC" : "\u25B6"}</span>
            <span>Recall Trace</span>
          </div>
        </div>

        <Show when={recallOpen()}>
          <div style={sectionContentStyle}>
            {/* Search bar */}
            <div style={{ display: "flex", gap: "4px", "margin-bottom": "8px" }}>
              <input
                type="text"
                placeholder="Search memory..."
                value={recallQuery()}
                onInput={(e) => setRecallQuery(e.currentTarget.value)}
                onKeyDown={doRecallKeyDown}
                style={{ ...inputStyle, flex: "1" }}
              />
              <button
                style={buttonStyle}
                disabled={recallStatus() === "loading" || !recallQuery().trim()}
                onClick={doRecall}
              >
                {recallStatus() === "loading" ? "Searching..." : "Recall"}
              </button>
            </div>

            {/* Status indicators */}
            <Show when={recallStatus() === "empty"}>
              <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", padding: "8px 0", "text-align": "center" }}>
                No matching memories found.
              </div>
            </Show>

            <Show when={recallStatus() === "failed"}>
              <div style={{ "font-size": "12px", color: "var(--vscode-errorForeground)", padding: "8px 0", "text-align": "center" }}>
                Recall failed. Check connection and try again.
              </div>
            </Show>

            {/* Results */}
            <Show when={recallResults().length > 0}>
              <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "4px" }}>
                {recallResults().length} result{recallResults().length !== 1 ? "s" : ""} found
              </div>
              <div style={{ display: "flex", "flex-direction": "column", gap: "4px", "max-height": "400px", "overflow-y": "auto" }}>
                <For each={recallResults()}>
                  {(entry) => {
                    const isExpanded = () => expandedRecallId() === entry.id
                    return (
                      <div
                        style={{
                          border: "1px solid var(--vscode-panel-border)",
                          "border-radius": "3px",
                          overflow: "hidden",
                        }}
                      >
                        {/* Summary row */}
                        <div
                          style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "6px 8px",
                            cursor: "pointer",
                            background: isExpanded() ? "var(--vscode-list-hoverBackground)" : "transparent",
                          }}
                          onClick={() => setExpandedRecallId(isExpanded() ? null : entry.id)}
                        >
                          <span style={{ "font-size": "10px", "flex-shrink": "0" }}>
                            {isExpanded() ? "\u25BC" : "\u25B6"}
                          </span>
                          <span style={{ flex: "1", "font-size": "12px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                            {entry.summary}
                          </span>
                          {factTypeBadge(entry.factType)}
                          {scopeBadge(entry.scope)}
                          {relevanceBar(entry.relevanceScore)}
                          <span style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)", "flex-shrink": "0" }}>
                            {formatTimestamp(entry.timestamp)}
                          </span>
                        </div>

                        {/* Expanded detail */}
                        <Show when={isExpanded()}>
                          <div
                            style={{
                              padding: "8px 12px",
                              "border-top": "1px solid var(--vscode-panel-border)",
                              "font-size": "12px",
                              background: "var(--vscode-textBlockQuote-background)",
                            }}
                          >
                            <div style={{ "margin-bottom": "6px" }}>
                              <div style={{ "font-weight": "600", "margin-bottom": "2px" }}>Content</div>
                              <div style={{ "white-space": "pre-wrap", "word-break": "break-word", color: "var(--vscode-foreground)" }}>
                                {entry.content}
                              </div>
                            </div>
                            <div style={{ display: "grid", "grid-template-columns": "auto 1fr", gap: "2px 10px", "font-size": "11px" }}>
                              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Project:</span>
                              <span>{entry.project}</span>
                              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Trace Ref:</span>
                              <span style={{ "font-family": "var(--vscode-editor-font-family)" }}>{entry.traceRef}</span>
                              <Show when={entry.agent}>
                                <span style={{ color: "var(--vscode-descriptionForeground)" }}>Agent:</span>
                                <span>{entry.agent}</span>
                              </Show>
                              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Score:</span>
                              <span>{(entry.relevanceScore * 100).toFixed(1)}%</span>
                            </div>
                            <div
                              style={{
                                "margin-top": "6px",
                                padding: "4px 8px",
                                background: "var(--vscode-editor-background)",
                                "border-radius": "3px",
                                "font-size": "11px",
                              }}
                            >
                              <div style={{ "font-weight": "600", "margin-bottom": "2px", color: "var(--vscode-descriptionForeground)" }}>
                                Match Explanation
                              </div>
                              <div style={{ color: "var(--vscode-foreground)" }}>{entry.matchReason}</div>
                            </div>
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* ═══════════════════════════════════════════════════════
          Memory Write History
          ═══════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <div
          style={sectionHeaderStyle}
          onClick={() => setHistoryOpen(!historyOpen())}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span>{historyOpen() ? "\u25BC" : "\u25B6"}</span>
            <span>Write History</span>
            <span style={{ "font-weight": "400", "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
              ({filteredHistory().length})
            </span>
          </div>
          <button
            style={buttonStyle}
            onClick={(e) => {
              e.stopPropagation()
              setShowWriteForm(!showWriteForm())
            }}
          >
            {showWriteForm() ? "Cancel" : "Write Memory"}
          </button>
        </div>

        <Show when={historyOpen()}>
          <div style={sectionContentStyle}>
            {/* Write form */}
            <Show when={showWriteForm()}>
              <div
                style={{
                  border: "1px solid var(--vscode-focusBorder)",
                  "border-radius": "3px",
                  padding: "8px",
                  "margin-bottom": "8px",
                  background: "var(--vscode-textBlockQuote-background)",
                }}
              >
                <div style={{ "font-weight": "600", "font-size": "12px", "margin-bottom": "6px" }}>
                  New Memory Entry
                </div>

                {/* Summary */}
                <div style={{ "margin-bottom": "6px" }}>
                  <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", display: "block", "margin-bottom": "2px" }}>
                    Summary
                  </label>
                  <textarea
                    style={textareaStyle}
                    placeholder="Brief summary of the memory..."
                    value={writeSummary()}
                    onInput={(e) => setWriteSummary(e.currentTarget.value)}
                    rows={2}
                  />
                </div>

                {/* Content (optional, defaults to summary) */}
                <div style={{ "margin-bottom": "6px" }}>
                  <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", display: "block", "margin-bottom": "2px" }}>
                    Content (optional, defaults to summary)
                  </label>
                  <textarea
                    style={textareaStyle}
                    placeholder="Full content or details..."
                    value={writeContent()}
                    onInput={(e) => setWriteContent(e.currentTarget.value)}
                    rows={3}
                  />
                </div>

                {/* Fact type + scope selectors */}
                <div style={{ display: "flex", gap: "8px", "margin-bottom": "6px" }}>
                  <div style={{ flex: "1" }}>
                    <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", display: "block", "margin-bottom": "2px" }}>
                      Fact Type
                    </label>
                    <select
                      style={inputStyle}
                      value={writeFactType()}
                      onChange={(e) => setWriteFactType(e.currentTarget.value as MemoryEntry["factType"])}
                    >
                      <option value="contract">Contract</option>
                      <option value="fix">Fix</option>
                      <option value="recall">Recall</option>
                      <option value="decision">Decision</option>
                    </select>
                  </div>
                  <div style={{ flex: "1" }}>
                    <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", display: "block", "margin-bottom": "2px" }}>
                      Scope
                    </label>
                    <select
                      style={inputStyle}
                      value={writeScope()}
                      onChange={(e) => setWriteScope(e.currentTarget.value as MemoryEntry["scope"])}
                    >
                      <option value="global">Global</option>
                      <option value="project">Project</option>
                      <option value="task">Task</option>
                    </select>
                  </div>
                </div>

                {/* Project name */}
                <div style={{ "margin-bottom": "8px" }}>
                  <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", display: "block", "margin-bottom": "2px" }}>
                    Project (auto-filled from workspace)
                  </label>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="Workspace project name"
                    value={writeProject()}
                    onInput={(e) => setWriteProject(e.currentTarget.value)}
                  />
                </div>

                {/* Submit */}
                <div style={{ display: "flex", "justify-content": "flex-end", gap: "4px" }}>
                  <button style={secondaryButtonStyle} onClick={() => setShowWriteForm(false)}>
                    Cancel
                  </button>
                  <button style={buttonStyle} disabled={!writeSummary().trim()} onClick={doWriteMemory}>
                    Save Memory
                  </button>
                </div>
              </div>
            </Show>

            {/* Filters */}
            <div style={{ display: "flex", gap: "8px", "margin-bottom": "8px", "flex-wrap": "wrap" }}>
              <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Type:</label>
                <select
                  style={{ ...inputStyle, width: "auto", "min-width": "80px" }}
                  value={historyFilterType()}
                  onChange={(e) => setHistoryFilterType(e.currentTarget.value)}
                >
                  <option value="all">All</option>
                  <option value="contract">Contract</option>
                  <option value="fix">Fix</option>
                  <option value="recall">Recall</option>
                  <option value="decision">Decision</option>
                </select>
              </div>
              <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Project:</label>
                <select
                  style={{ ...inputStyle, width: "auto", "min-width": "80px" }}
                  value={historyFilterProject()}
                  onChange={(e) => setHistoryFilterProject(e.currentTarget.value)}
                >
                  <option value="all">All</option>
                  <For each={uniqueProjects()}>
                    {(p) => <option value={p}>{p}</option>}
                  </For>
                </select>
              </div>
              <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Scope:</label>
                <select
                  style={{ ...inputStyle, width: "auto", "min-width": "80px" }}
                  value={historyFilterScope()}
                  onChange={(e) => setHistoryFilterScope(e.currentTarget.value)}
                >
                  <option value="all">All</option>
                  <option value="global">Global</option>
                  <option value="project">Project</option>
                  <option value="task">Task</option>
                </select>
              </div>
            </div>

            {/* History list */}
            <Show
              when={filteredHistory().length > 0}
              fallback={
                <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", padding: "8px 0", "text-align": "center" }}>
                  No memory writes recorded.
                </div>
              }
            >
              <div style={{ "max-height": "350px", "overflow-y": "auto" }}>
                <For each={filteredHistory()}>
                  {(record) => (
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "8px",
                        padding: "4px 0",
                        "border-bottom": "1px solid var(--vscode-panel-border)",
                        "font-size": "12px",
                      }}
                    >
                      <span style={{ flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {record.summary}
                      </span>
                      {factTypeBadge(record.factType)}
                      {scopeBadge(record.scope)}
                      <span
                        style={{
                          "font-size": "10px",
                          color: "var(--vscode-descriptionForeground)",
                          "flex-shrink": "0",
                          "max-width": "80px",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                        title={record.project}
                      >
                        {record.project}
                      </span>
                      <span style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)", "flex-shrink": "0" }}>
                        {formatTimestamp(record.timestamp)}
                      </span>
                      <span
                        style={{
                          "font-size": "9px",
                          "font-family": "var(--vscode-editor-font-family)",
                          color: "var(--vscode-descriptionForeground)",
                          "flex-shrink": "0",
                        }}
                        title={`Trace: ${record.traceRef}`}
                      >
                        {record.traceRef.slice(0, 12)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* ═══════════════════════════════════════════════════════
          Cross-Agent Memory
          ═══════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <div
          style={sectionHeaderStyle}
          onClick={() => setAgentOpen(!agentOpen())}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span>{agentOpen() ? "\u25BC" : "\u25B6"}</span>
            <span>Cross-Agent Memory</span>
            <span style={{ "font-weight": "400", "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
              ({permissions().length} agent{permissions().length !== 1 ? "s" : ""})
            </span>
          </div>
        </div>

        <Show when={agentOpen()}>
          <div style={sectionContentStyle}>
            {/* Add agent */}
            <div style={{ display: "flex", gap: "4px", "margin-bottom": "8px" }}>
              <input
                type="text"
                placeholder="Add agent ID..."
                value={newAgentId()}
                onInput={(e) => setNewAgentId(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    doAddAgent()
                  }
                }}
                style={{ ...inputStyle, flex: "1" }}
              />
              <button style={buttonStyle} disabled={!newAgentId().trim()} onClick={doAddAgent}>
                Add Agent
              </button>
            </div>

            {/* Permissions matrix */}
            <Show
              when={permissions().length > 0}
              fallback={
                <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", padding: "8px 0", "text-align": "center" }}>
                  No agents configured. Add an agent ID above to manage memory sharing.
                </div>
              }
            >
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "1fr 70px 70px 70px",
                  gap: "4px",
                  padding: "4px 0",
                  "border-bottom": "2px solid var(--vscode-panel-border)",
                  "font-size": "11px",
                  "font-weight": "600",
                  color: "var(--vscode-descriptionForeground)",
                }}
              >
                <span>Agent</span>
                <span style={{ "text-align": "center" }}>Global</span>
                <span style={{ "text-align": "center" }}>Project</span>
                <span style={{ "text-align": "center" }}>Task</span>
              </div>

              {/* Rows */}
              <For each={permissions()}>
                {(perm) => (
                  <div
                    style={{
                      display: "grid",
                      "grid-template-columns": "1fr 70px 70px 70px",
                      gap: "4px",
                      padding: "4px 0",
                      "border-bottom": "1px solid var(--vscode-panel-border)",
                      "align-items": "center",
                      "font-size": "12px",
                    }}
                  >
                    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          "border-radius": "50%",
                          background: "var(--vscode-testing-iconPassed)",
                          "flex-shrink": "0",
                        }}
                        title="Active"
                      />
                      <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {perm.agentId}
                      </span>
                    </div>
                    <div style={{ "text-align": "center" }}>
                      <input
                        type="checkbox"
                        checked={perm.scopes.global}
                        onChange={(e) => doSetPermission(perm.agentId, "global", e.currentTarget.checked)}
                        style={{ cursor: "pointer", "accent-color": "var(--vscode-focusBorder)" }}
                        title={`${perm.agentId}: global scope ${perm.scopes.global ? "allowed" : "denied"}`}
                      />
                    </div>
                    <div style={{ "text-align": "center" }}>
                      <input
                        type="checkbox"
                        checked={perm.scopes.project}
                        onChange={(e) => doSetPermission(perm.agentId, "project", e.currentTarget.checked)}
                        style={{ cursor: "pointer", "accent-color": "var(--vscode-focusBorder)" }}
                        title={`${perm.agentId}: project scope ${perm.scopes.project ? "allowed" : "denied"}`}
                      />
                    </div>
                    <div style={{ "text-align": "center" }}>
                      <input
                        type="checkbox"
                        checked={perm.scopes.task}
                        onChange={(e) => doSetPermission(perm.agentId, "task", e.currentTarget.checked)}
                        style={{ cursor: "pointer", "accent-color": "var(--vscode-focusBorder)" }}
                        title={`${perm.agentId}: task scope ${perm.scopes.task ? "allowed" : "denied"}`}
                      />
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>

      {/* ═══════════════════════════════════════════════════════
          Health & Diagnostics
          ═══════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <div
          style={sectionHeaderStyle}
          onClick={() => setHealthOpen(!healthOpen())}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span>{healthOpen() ? "\u25BC" : "\u25B6"}</span>
            <span>Health & Diagnostics</span>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                "border-radius": "50%",
                background: healthStatusColors[health().status] ?? healthStatusColors.unavailable,
              }}
              title={health().status}
            />
            <span style={{ "font-weight": "400", "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
              {health().status}
            </span>
          </div>
          <button
            style={secondaryButtonStyle}
            disabled={diagRunning()}
            onClick={(e) => {
              e.stopPropagation()
              doRunDiagnostics()
            }}
          >
            {diagRunning() ? "Running..." : "Run Diagnostics"}
          </button>
        </div>

        <Show when={healthOpen()}>
          <div style={sectionContentStyle}>
            {/* Health metrics */}
            <div style={{ display: "grid", "grid-template-columns": "auto 1fr", gap: "4px 12px", "font-size": "12px", "margin-bottom": "8px" }}>
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Status:</span>
              <span style={{ color: healthStatusColors[health().status] ?? "var(--vscode-foreground)", "font-weight": "600" }}>
                {health().status.charAt(0).toUpperCase() + health().status.slice(1)}
              </span>
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Error Rate:</span>
              <span>{(health().errorRate * 100).toFixed(1)}%</span>
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Consecutive Failures:</span>
              <span style={{ color: health().consecutiveFailures > 0 ? "var(--vscode-errorForeground)" : "var(--vscode-foreground)" }}>
                {health().consecutiveFailures}
              </span>
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Last Write:</span>
              <span>{health().lastSuccessfulWrite ? formatTimestamp(health().lastSuccessfulWrite!) : "Never"}</span>
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Last Recall:</span>
              <span>{health().lastSuccessfulRecall ? formatTimestamp(health().lastSuccessfulRecall!) : "Never"}</span>
            </div>

            {/* Diagnostic results */}
            <Show when={diagnosticResult()}>
              {(result) => (
                <div
                  style={{
                    border: "1px solid var(--vscode-panel-border)",
                    "border-radius": "3px",
                    padding: "8px",
                    background: "var(--vscode-textBlockQuote-background)",
                  }}
                >
                  <div style={{ "font-weight": "600", "font-size": "12px", "margin-bottom": "6px" }}>
                    Diagnostic Results
                    <span style={{ "font-weight": "400", "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-left": "8px" }}>
                      ({result().latencyMs}ms)
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "16px", "font-size": "12px", "margin-bottom": "6px" }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: "8px",
                          height: "8px",
                          "border-radius": "50%",
                          background: result().connectivity ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)",
                        }}
                      />
                      <span>Connectivity</span>
                    </div>
                    <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: "8px",
                          height: "8px",
                          "border-radius": "50%",
                          background: result().writeTest ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)",
                        }}
                      />
                      <span>Write</span>
                    </div>
                    <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: "8px",
                          height: "8px",
                          "border-radius": "50%",
                          background: result().recallTest ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)",
                        }}
                      />
                      <span>Recall</span>
                    </div>
                  </div>
                  <Show when={result().errors.length > 0}>
                    <div style={{ "font-size": "11px", color: "var(--vscode-errorForeground)", "margin-top": "4px" }}>
                      <For each={result().errors}>
                        {(err) => <div style={{ padding: "1px 0" }}>- {err}</div>}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>

      {/* ═══════════════════════════════════════════════════════
          Agent Recall Traces
          ═══════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <div
          style={sectionHeaderStyle}
          onClick={() => {
            const opening = !tracesOpen()
            setTracesOpen(opening)
            if (opening) doLoadRecallTraces()
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span>{tracesOpen() ? "\u25BC" : "\u25B6"}</span>
            <span>Agent Recall Traces</span>
            <Show when={recallTraces().length > 0}>
              <span style={{ "font-weight": "400", "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                ({recallTraces().length})
              </span>
            </Show>
          </div>
          <Show when={tracesOpen()}>
            <button
              style={secondaryButtonStyle}
              onClick={(e) => {
                e.stopPropagation()
                doLoadRecallTraces()
              }}
            >
              Refresh
            </button>
          </Show>
        </div>

        <Show when={tracesOpen()}>
          <div style={sectionContentStyle}>
            <Show
              when={recallTraces().length > 0}
              fallback={
                <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", padding: "8px 0", "text-align": "center" }}>
                  No cross-agent recall traces recorded.
                </div>
              }
            >
              <div style={{ "max-height": "350px", "overflow-y": "auto", display: "flex", "flex-direction": "column", gap: "4px" }}>
                <For each={recallTraces().slice().reverse()}>
                  {(trace, idx) => {
                    const isExpanded = () => expandedTraceIdx() === idx()
                    return (
                      <div
                        style={{
                          border: "1px solid var(--vscode-panel-border)",
                          "border-radius": "3px",
                          overflow: "hidden",
                        }}
                      >
                        {/* Trace summary row */}
                        <div
                          style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "6px 8px",
                            cursor: "pointer",
                            background: isExpanded() ? "var(--vscode-list-hoverBackground)" : "transparent",
                          }}
                          onClick={() => setExpandedTraceIdx(isExpanded() ? null : idx())}
                        >
                          <span style={{ "font-size": "10px", "flex-shrink": "0" }}>
                            {isExpanded() ? "\u25BC" : "\u25B6"}
                          </span>
                          <span
                            style={{
                              "font-size": "11px",
                              padding: "1px 6px",
                              "border-radius": "8px",
                              background: "var(--vscode-badge-background)",
                              color: "var(--vscode-badge-foreground)",
                              "flex-shrink": "0",
                            }}
                          >
                            {trace.requestingAgent}
                          </span>
                          <span style={{ flex: "1", "font-size": "12px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                            {trace.query}
                          </span>
                          <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "flex-shrink": "0" }}>
                            {trace.entriesReturned}/{trace.entriesSearched}
                          </span>
                          <span style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)", "flex-shrink": "0" }}>
                            {formatTimestamp(trace.timestamp)}
                          </span>
                        </div>

                        {/* Expanded trace detail */}
                        <Show when={isExpanded()}>
                          <div
                            style={{
                              padding: "8px 12px",
                              "border-top": "1px solid var(--vscode-panel-border)",
                              "font-size": "12px",
                              background: "var(--vscode-textBlockQuote-background)",
                            }}
                          >
                            <div style={{ display: "grid", "grid-template-columns": "auto 1fr", gap: "2px 10px", "font-size": "11px", "margin-bottom": "6px" }}>
                              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Agent:</span>
                              <span>{trace.requestingAgent}</span>
                              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Query:</span>
                              <span style={{ "word-break": "break-word" }}>{trace.query}</span>
                              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Searched:</span>
                              <span>{trace.entriesSearched} entries</span>
                              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Returned:</span>
                              <span>{trace.entriesReturned} entries</span>
                            </div>

                            <Show when={trace.permissionChecks.length > 0}>
                              <div style={{ "font-weight": "600", "font-size": "11px", "margin-bottom": "4px", color: "var(--vscode-descriptionForeground)" }}>
                                Permission Checks
                              </div>
                              <div style={{ "max-height": "100px", "overflow-y": "auto", "font-size": "11px" }}>
                                <For each={trace.permissionChecks}>
                                  {(check) => (
                                    <div style={{ display: "flex", "align-items": "center", gap: "6px", padding: "1px 0" }}>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          width: "6px",
                                          height: "6px",
                                          "border-radius": "50%",
                                          background: check.granted ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)",
                                          "flex-shrink": "0",
                                        }}
                                      />
                                      <span style={{ color: "var(--vscode-descriptionForeground)" }}>{check.scope}:</span>
                                      <span style={{ color: check.granted ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)" }}>
                                        {check.granted ? "granted" : "denied"}
                                      </span>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default MemoryTab
