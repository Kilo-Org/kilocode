import { Component, createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

// ─── Types ───────────────────────────────────────────────

interface ProviderConfig {
  id: string
  name: string
  apiKeyConfigured: boolean
  roles: string[]
  status: "healthy" | "degraded" | "offline" | "unconfigured"
  lastHealthCheck?: number
  circuitBreaker: "closed" | "open" | "half-open"
  requestCount: number
  failureCount: number
  estimatedCost: number
  wrongRoleBlocks: number
  retriesUsed: number
}

interface RouteDecision {
  taskType: string
  riskLevel: string
  primaryProvider: string
  fallbackProvider?: string
  reason: string
  timestamp: number
  success: boolean
  fallbackUsed: boolean
  fallbackDepth: number
  trace: RouteTraceStep[]
}

interface RouteTraceStep {
  step: string
  provider?: string
  result: "selected" | "skipped" | "blocked" | "failed"
  reason: string
  timestamp: number
}

interface RoutingConfig {
  mode: "auto" | "manual"
  fallbackOrder: string[]
  privacyMode: "local_preferred" | "cloud_ok"
  costThreshold: number
}

interface HealthSummary {
  providers: ProviderConfig[]
  totalRequests: number
  totalFailures: number
  totalCost: number
  totalWrongRoleBlocks: number
}

// ─── Constants ───────────────────────────────────────────

const ALL_ROLES = [
  "Contract Writing",
  "Architecture",
  "Audits",
  "Release Verdicts",
  "Execution Worker",
  "Fallback",
  "Local/Private",
]

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "claude",
    name: "Claude",
    apiKeyConfigured: false,
    roles: ["Contract Writing", "Audits", "Architecture", "Release Verdicts"],
    status: "unconfigured",
    circuitBreaker: "closed",
    requestCount: 0,
    failureCount: 0,
    estimatedCost: 0,
    wrongRoleBlocks: 0,
    retriesUsed: 0,
  },
  {
    id: "minimax",
    name: "MiniMax",
    apiKeyConfigured: false,
    roles: ["Execution Worker"],
    status: "unconfigured",
    circuitBreaker: "closed",
    requestCount: 0,
    failureCount: 0,
    estimatedCost: 0,
    wrongRoleBlocks: 0,
    retriesUsed: 0,
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    apiKeyConfigured: false,
    roles: ["Fallback"],
    status: "unconfigured",
    circuitBreaker: "closed",
    requestCount: 0,
    failureCount: 0,
    estimatedCost: 0,
    wrongRoleBlocks: 0,
    retriesUsed: 0,
  },
  {
    id: "ollama",
    name: "Ollama",
    apiKeyConfigured: false,
    roles: ["Local/Private", "Execution Worker"],
    status: "offline",
    circuitBreaker: "closed",
    requestCount: 0,
    failureCount: 0,
    estimatedCost: 0,
    wrongRoleBlocks: 0,
    retriesUsed: 0,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    apiKeyConfigured: false,
    roles: ["Local/Private"],
    status: "offline",
    circuitBreaker: "closed",
    requestCount: 0,
    failureCount: 0,
    estimatedCost: 0,
    wrongRoleBlocks: 0,
    retriesUsed: 0,
  },
]

const DEFAULT_CONFIG: RoutingConfig = {
  mode: "auto",
  fallbackOrder: ["claude", "minimax", "siliconflow", "ollama", "lmstudio"],
  privacyMode: "cloud_ok",
  costThreshold: 10.0,
}

// ─── Styles ──────────────────────────────────────────────

const inputStyle: Record<string, string> = {
  width: "100%",
  padding: "4px 8px",
  border: "1px solid var(--vscode-input-border)",
  background: "var(--vscode-input-background)",
  color: "var(--vscode-input-foreground)",
  "border-radius": "2px",
  "font-size": "13px",
}

const sectionHeaderStyle = (clickable: boolean): Record<string, string> => ({
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "8px 12px",
  cursor: clickable ? "pointer" : "default",
  "user-select": "none",
  "font-weight": "600",
  "font-size": "13px",
})

function statusColor(status: string): string {
  switch (status) {
    case "healthy":
      return "var(--vscode-testing-iconPassed)"
    case "degraded":
      return "var(--vscode-editorWarning-foreground)"
    case "offline":
      return "var(--vscode-testing-iconFailed)"
    case "unconfigured":
      return "var(--vscode-descriptionForeground)"
    default:
      return "var(--vscode-descriptionForeground)"
  }
}

function circuitColor(state: string): string {
  switch (state) {
    case "closed":
      return "var(--vscode-testing-iconPassed)"
    case "half-open":
      return "var(--vscode-editorWarning-foreground)"
    case "open":
      return "var(--vscode-testing-iconFailed)"
    default:
      return "var(--vscode-descriptionForeground)"
  }
}

function decisionColor(d: RouteDecision): string {
  if (!d.success) return "var(--vscode-testing-iconFailed)"
  if (d.fallbackUsed) return "var(--vscode-editorWarning-foreground)"
  return "var(--vscode-testing-iconPassed)"
}

function formatTimestamp(ts: number): string {
  if (!ts) return "Never"
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

function formatTimeAgo(ts: number | undefined): string {
  if (!ts) return "Never"
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

// ─── Sub-Components ──────────────────────────────────────

const StatusBadge: Component<{ status: string }> = (props) => (
  <span
    style={{
      display: "inline-flex",
      "align-items": "center",
      gap: "4px",
      padding: "1px 8px",
      "border-radius": "10px",
      "font-size": "11px",
      "font-weight": "500",
      background: "var(--vscode-badge-background)",
      color: statusColor(props.status),
      border: `1px solid ${statusColor(props.status)}`,
    }}
  >
    <span
      style={{
        width: "6px",
        height: "6px",
        "border-radius": "50%",
        background: statusColor(props.status),
      }}
    />
    {props.status}
  </span>
)

const CircuitBadge: Component<{ state: string }> = (props) => (
  <span
    style={{
      display: "inline-flex",
      "align-items": "center",
      gap: "3px",
      padding: "1px 6px",
      "border-radius": "8px",
      "font-size": "10px",
      background: "var(--vscode-textBlockQuote-background)",
      color: circuitColor(props.state),
    }}
  >
    CB: {props.state}
  </span>
)

const RoleBadge: Component<{ role: string }> = (props) => (
  <span
    style={{
      display: "inline-block",
      padding: "1px 6px",
      "border-radius": "8px",
      "font-size": "10px",
      background: "var(--vscode-badge-background)",
      color: "var(--vscode-badge-foreground)",
      "margin-right": "4px",
      "margin-bottom": "2px",
    }}
  >
    {props.role}
  </span>
)

const BarSegment: Component<{ value: number; total: number; color: string; label: string }> = (props) => {
  const pct = () => (props.total > 0 ? Math.max(1, (props.value / props.total) * 100) : 0)
  return (
    <Show when={props.value > 0}>
      <div
        title={`${props.label}: ${props.value}`}
        style={{
          width: `${pct()}%`,
          height: "20px",
          background: props.color,
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "font-size": "10px",
          color: "#fff",
          "min-width": "20px",
          overflow: "hidden",
          "white-space": "nowrap",
        }}
      >
        {props.value}
      </div>
    </Show>
  )
}

// ─── Main Component ──────────────────────────────────────

const RoutingTab: Component = () => {
  const vscode = useVSCode()

  // ── State ────────────────────────────────────────────────
  const [providers, setProviders] = createSignal<ProviderConfig[]>(DEFAULT_PROVIDERS)
  const [traces, setTraces] = createSignal<RouteDecision[]>([])
  const [config, setConfig] = createSignal<RoutingConfig>({ ...DEFAULT_CONFIG })
  const [health, setHealth] = createSignal<HealthSummary>({
    providers: DEFAULT_PROVIDERS,
    totalRequests: 0,
    totalFailures: 0,
    totalCost: 0,
    totalWrongRoleBlocks: 0,
  })

  // Section collapse state
  const [registryOpen, setRegistryOpen] = createSignal(true)
  const [roleMatrixOpen, setRoleMatrixOpen] = createSignal(true)
  const [tracesOpen, setTracesOpen] = createSignal(false)
  const [healthOpen, setHealthOpen] = createSignal(false)
  const [configOpen, setConfigOpen] = createSignal(true)

  // Per-provider inline key input
  const [configuringProvider, setConfiguringProvider] = createSignal<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = createSignal("")
  const [testingProvider, setTestingProvider] = createSignal<string | null>(null)

  // Expanded trace detail
  const [expandedTrace, setExpandedTrace] = createSignal<number | null>(null)

  // Fallback reorder
  const [editingFallback, setEditingFallback] = createSignal(false)

  // ── Message Handler ──────────────────────────────────────
  const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
    const m = msg as unknown as Record<string, unknown>
    if (m.type === "routingProvidersLoaded") {
      const data = m as unknown as { providers: ProviderConfig[] }
      setProviders(data.providers)
    }
    if (m.type === "routingTracesLoaded") {
      const data = m as unknown as { traces: RouteDecision[] }
      setTraces(data.traces)
    }
    if (m.type === "routingHealthLoaded") {
      const data = m as unknown as { health: HealthSummary }
      setHealth(data.health)
      if (data.health.providers) {
        setProviders(data.health.providers)
      }
    }
    if (m.type === "routingConfigLoaded") {
      const data = m as unknown as { config: RoutingConfig }
      setConfig(data.config)
    }
    if (m.type === "routingTestResult") {
      const data = m as unknown as { providerId: string; success: boolean }
      setTestingProvider(null)
      setProviders((prev) =>
        prev.map((p) =>
          p.id === data.providerId
            ? {
                ...p,
                status: data.success ? "healthy" : "offline",
                lastHealthCheck: Date.now(),
              }
            : p,
        ),
      )
    }
    if (m.type === "routingKeyConfigured") {
      const data = m as unknown as { providerId: string; configured: boolean }
      setProviders((prev) =>
        prev.map((p) =>
          p.id === data.providerId
            ? {
                ...p,
                apiKeyConfigured: data.configured,
                status: data.configured ? "healthy" : "unconfigured",
              }
            : p,
        ),
      )
      setConfiguringProvider(null)
      setApiKeyInput("")
    }
  })

  onCleanup(unsubscribe)

  // ── Initial Data Fetch ───────────────────────────────────
  createEffect(() => {
    // Request the full routing state (providers, config, health, traces) on tab open
    vscode.postMessage({ type: "requestRoutingState" } as never)
  })

  // ── Actions ──────────────────────────────────────────────

  const testConnection = (pid: string) => {
    setTestingProvider(pid)
    vscode.postMessage({ type: "routingTestProvider", providerId: pid } as never)
    // Safety timeout: if backend never responds (hung fetch, network issue),
    // clear the "Testing..." state after 15 seconds so the button becomes clickable again.
    setTimeout(() => {
      if (testingProvider() === pid) {
        console.warn("[RoutingTab] Test timeout for", pid, "— clearing testing state")
        setTestingProvider(null)
      }
    }, 15000)
  }

  const configureKey = (pid: string) => {
    if (configuringProvider() === pid) {
      // Submit the key
      if (apiKeyInput().trim()) {
        vscode.postMessage({
          type: "routingConfigureKey",
          providerId: pid,
          apiKey: apiKeyInput().trim(),
        } as never)
      }
      setConfiguringProvider(null)
      setApiKeyInput("")
    } else {
      setConfiguringProvider(pid)
      setApiKeyInput("")
    }
  }

  const toggleRole = (pid: string, role: string, enabled: boolean) => {
    vscode.postMessage({
      type: "routingSetRole",
      providerId: pid,
      role,
      enabled,
    } as never)
    // Optimistic update
    setProviders((prev) =>
      prev.map((p) => {
        if (p.id !== pid) return p
        const roles = enabled ? [...p.roles, role] : p.roles.filter((r) => r !== role)
        return { ...p, roles }
      }),
    )
  }

  const setMode = (mode: "auto" | "manual") => {
    setConfig((prev) => ({ ...prev, mode }))
    vscode.postMessage({ type: "routingSetMode", mode } as never)
  }

  const setPrivacy = (privacyMode: "local_preferred" | "cloud_ok") => {
    setConfig((prev) => ({ ...prev, privacyMode }))
    vscode.postMessage({ type: "routingSetMode", privacyMode } as never)
  }

  const setCostThreshold = (value: number) => {
    setConfig((prev) => ({ ...prev, costThreshold: value }))
  }

  const saveCostThreshold = () => {
    vscode.postMessage({
      type: "routingSetMode",
      costThreshold: config().costThreshold,
    } as never)
  }

  const moveFallback = (index: number, direction: "up" | "down") => {
    setConfig((prev) => {
      const order = [...prev.fallbackOrder]
      const newIndex = direction === "up" ? index - 1 : index + 1
      if (newIndex < 0 || newIndex >= order.length) return prev
      const tmp = order[index]
      order[index] = order[newIndex]
      order[newIndex] = tmp
      vscode.postMessage({ type: "routingSetFallbackOrder", order } as never)
      return { ...prev, fallbackOrder: order }
    })
  }

  const providerName = (id: string): string => {
    const p = providers().find((p) => p.id === id)
    return p?.name ?? id
  }

  // ── Render ───────────────────────────────────────────────

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      {/* ── Provider Registry ─────────────────────────────── */}
      <Card>
        <div style={sectionHeaderStyle(true)} onClick={() => setRegistryOpen((v) => !v)}>
          <span>{registryOpen() ? "\u25BE" : "\u25B8"} Provider Registry</span>
          <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "font-weight": "400" }}>
            {providers().filter((p) => p.status === "healthy").length}/{providers().length} healthy
          </span>
        </div>

        <Show when={registryOpen()}>
          <div style={{ padding: "0 12px 12px" }}>
            <For each={providers()}>
              {(provider) => (
                <div
                  style={{
                    border: "1px solid var(--vscode-panel-border)",
                    "border-radius": "4px",
                    padding: "10px 12px",
                    "margin-bottom": "8px",
                    background: "var(--vscode-editor-background)",
                  }}
                >
                  {/* Provider Header */}
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "space-between",
                      "margin-bottom": "6px",
                    }}
                  >
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      <span style={{ "font-weight": "600", "font-size": "13px" }}>{provider.name}</span>
                      <StatusBadge status={provider.status} />
                      <CircuitBadge state={provider.circuitBreaker} />
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => testConnection(provider.id)}
                        disabled={testingProvider() === provider.id}
                      >
                        {testingProvider() === provider.id ? "Testing..." : "Test Connection"}
                      </Button>
                      <Button variant="secondary" size="small" onClick={() => configureKey(provider.id)}>
                        {configuringProvider() === provider.id ? "Save Key" : "Configure"}
                      </Button>
                    </div>
                  </div>

                  {/* API Key Status */}
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "6px",
                      "margin-bottom": "4px",
                      "font-size": "12px",
                      color: "var(--vscode-descriptionForeground)",
                    }}
                  >
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        "border-radius": "50%",
                        background: provider.apiKeyConfigured
                          ? "var(--vscode-testing-iconPassed)"
                          : "var(--vscode-testing-iconFailed)",
                        display: "inline-block",
                      }}
                    />
                    API Key: {provider.apiKeyConfigured ? "Configured" : "Missing"}
                    <span style={{ "margin-left": "12px" }}>
                      Last checked: {formatTimeAgo(provider.lastHealthCheck)}
                    </span>
                  </div>

                  {/* Roles */}
                  <div style={{ display: "flex", "flex-wrap": "wrap", "margin-top": "4px" }}>
                    <For each={provider.roles}>{(role) => <RoleBadge role={role} />}</For>
                  </div>

                  {/* Inline API Key Input */}
                  <Show when={configuringProvider() === provider.id}>
                    <div
                      style={{
                        "margin-top": "8px",
                        display: "flex",
                        gap: "4px",
                        "align-items": "center",
                      }}
                    >
                      <input
                        type="password"
                        value={apiKeyInput()}
                        onInput={(e) => setApiKeyInput(e.currentTarget.value)}
                        placeholder={
                          provider.id === "ollama" || provider.id === "lmstudio"
                            ? "No key needed (local) -- press Save to confirm"
                            : "Enter API key..."
                        }
                        style={{ ...inputStyle, flex: "1" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") configureKey(provider.id)
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => {
                          setConfiguringProvider(null)
                          setApiKeyInput("")
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Show>

                  {/* Stats row */}
                  <div
                    style={{
                      display: "flex",
                      gap: "16px",
                      "margin-top": "6px",
                      "font-size": "11px",
                      color: "var(--vscode-descriptionForeground)",
                    }}
                  >
                    <span>Requests: {provider.requestCount}</span>
                    <span>Failures: {provider.failureCount}</span>
                    <span>Cost: ${provider.estimatedCost.toFixed(4)}</span>
                    <span>Wrong-role blocks: {provider.wrongRoleBlocks}</span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Card>

      {/* ── Role Matrix ───────────────────────────────────── */}
      <Card>
        <div style={sectionHeaderStyle(true)} onClick={() => setRoleMatrixOpen((v) => !v)}>
          <span>{roleMatrixOpen() ? "\u25BE" : "\u25B8"} Role Matrix</span>
          <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "font-weight": "400" }}>
            {ALL_ROLES.length} roles / {providers().length} providers
          </span>
        </div>

        <Show when={roleMatrixOpen()}>
          <div style={{ padding: "0 12px 12px", "overflow-x": "auto" }}>
            <table
              style={{
                width: "100%",
                "border-collapse": "collapse",
                "font-size": "12px",
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      "text-align": "left",
                      padding: "6px 8px",
                      "border-bottom": "2px solid var(--vscode-panel-border)",
                      color: "var(--vscode-foreground)",
                      "font-weight": "600",
                    }}
                  >
                    Role
                  </th>
                  <For each={providers()}>
                    {(p) => (
                      <th
                        style={{
                          "text-align": "center",
                          padding: "6px 8px",
                          "border-bottom": "2px solid var(--vscode-panel-border)",
                          color: "var(--vscode-foreground)",
                          "font-weight": "600",
                          "min-width": "80px",
                        }}
                      >
                        {p.name}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={ALL_ROLES}>
                  {(role) => (
                    <tr>
                      <td
                        style={{
                          padding: "4px 8px",
                          "border-bottom": "1px solid var(--vscode-panel-border)",
                          color: "var(--vscode-foreground)",
                          "white-space": "nowrap",
                        }}
                      >
                        {role}
                      </td>
                      <For each={providers()}>
                        {(provider) => {
                          const hasRole = () => provider.roles.includes(role)
                          return (
                            <td
                              style={{
                                "text-align": "center",
                                padding: "4px 8px",
                                "border-bottom": "1px solid var(--vscode-panel-border)",
                              }}
                            >
                              <Switch
                                checked={hasRole()}
                                onChange={(checked) => toggleRole(provider.id, role, checked)}
                                hideLabel
                              >
                                {`${provider.name}: ${role}`}
                              </Switch>
                            </td>
                          )
                        }}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Card>

      {/* ── Route Trace Viewer ────────────────────────────── */}
      <Card>
        <div style={sectionHeaderStyle(true)} onClick={() => setTracesOpen((v) => !v)}>
          <span>{tracesOpen() ? "\u25BE" : "\u25B8"} Route Trace Viewer</span>
          <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "font-weight": "400" }}>
            {traces().length} decisions
          </span>
        </div>

        <Show when={tracesOpen()}>
          <div style={{ padding: "0 12px 12px" }}>
            <Show
              when={traces().length > 0}
              fallback={
                <div
                  style={{
                    padding: "16px",
                    "text-align": "center",
                    color: "var(--vscode-descriptionForeground)",
                    "font-size": "12px",
                  }}
                >
                  No routing decisions recorded yet. Decisions will appear here as tasks are routed.
                </div>
              }
            >
              <For each={traces()}>
                {(decision, index) => (
                  <div
                    style={{
                      border: "1px solid var(--vscode-panel-border)",
                      "border-left": `3px solid ${decisionColor(decision)}`,
                      "border-radius": "4px",
                      padding: "8px 10px",
                      "margin-bottom": "6px",
                      background: "var(--vscode-editor-background)",
                      cursor: "pointer",
                    }}
                    onClick={() => setExpandedTrace((prev) => (prev === index() ? null : index()))}
                  >
                    {/* Decision summary row */}
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "space-between",
                        "font-size": "12px",
                      }}
                    >
                      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            "border-radius": "50%",
                            background: decisionColor(decision),
                            display: "inline-block",
                            "flex-shrink": "0",
                          }}
                        />
                        <span style={{ "font-weight": "600" }}>{decision.taskType}</span>
                        <span
                          style={{
                            padding: "0 4px",
                            "border-radius": "4px",
                            "font-size": "10px",
                            background:
                              decision.riskLevel === "high"
                                ? "var(--vscode-inputValidation-errorBackground)"
                                : decision.riskLevel === "medium"
                                  ? "var(--vscode-inputValidation-warningBackground)"
                                  : "var(--vscode-textBlockQuote-background)",
                            color: "var(--vscode-foreground)",
                          }}
                        >
                          {decision.riskLevel} risk
                        </span>
                        <span style={{ color: "var(--vscode-descriptionForeground)" }}>
                          {"\u2192"} {providerName(decision.primaryProvider)}
                        </span>
                        <Show when={decision.fallbackProvider}>
                          <span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "11px" }}>
                            (fallback: {providerName(decision.fallbackProvider!)})
                          </span>
                        </Show>
                      </div>
                      <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                        {formatTimestamp(decision.timestamp)}
                      </span>
                    </div>

                    {/* Reason */}
                    <div
                      style={{
                        "font-size": "11px",
                        color: "var(--vscode-descriptionForeground)",
                        "margin-top": "4px",
                        "padding-left": "16px",
                      }}
                    >
                      {decision.reason}
                    </div>

                    {/* Expanded trace detail */}
                    <Show when={expandedTrace() === index()}>
                      <div
                        style={{
                          "margin-top": "8px",
                          "padding-left": "16px",
                          "border-top": "1px solid var(--vscode-panel-border)",
                          "padding-top": "8px",
                        }}
                      >
                        <div
                          style={{
                            "font-size": "11px",
                            "font-weight": "600",
                            "margin-bottom": "4px",
                            color: "var(--vscode-foreground)",
                          }}
                        >
                          Trace Steps:
                        </div>
                        <For each={decision.trace}>
                          {(step) => (
                            <div
                              style={{
                                display: "flex",
                                "align-items": "flex-start",
                                gap: "6px",
                                "font-size": "11px",
                                "margin-bottom": "3px",
                                "padding-left": "8px",
                              }}
                            >
                              <span
                                style={{
                                  width: "6px",
                                  height: "6px",
                                  "border-radius": "50%",
                                  "margin-top": "4px",
                                  "flex-shrink": "0",
                                  background:
                                    step.result === "selected"
                                      ? "var(--vscode-testing-iconPassed)"
                                      : step.result === "skipped"
                                        ? "var(--vscode-editorWarning-foreground)"
                                        : step.result === "blocked"
                                          ? "var(--vscode-testing-iconFailed)"
                                          : "var(--vscode-testing-iconFailed)",
                                }}
                              />
                              <span style={{ color: "var(--vscode-descriptionForeground)" }}>
                                <strong>{step.step}</strong>
                                <Show when={step.provider}>
                                  {" "}
                                  [{step.provider}]
                                </Show>
                                {" -- "}
                                {step.reason}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </Card>

      {/* ── Health & Cost Dashboard ───────────────────────── */}
      <Card>
        <div style={sectionHeaderStyle(true)} onClick={() => setHealthOpen((v) => !v)}>
          <span>{healthOpen() ? "\u25BE" : "\u25B8"} Health & Cost Dashboard</span>
        </div>

        <Show when={healthOpen()}>
          <div style={{ padding: "0 12px 12px" }}>
            {/* Summary stats */}
            <div
              style={{
                display: "grid",
                "grid-template-columns": "repeat(4, 1fr)",
                gap: "8px",
                "margin-bottom": "12px",
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--vscode-textBlockQuote-background)",
                  "border-radius": "4px",
                  "text-align": "center",
                }}
              >
                <div style={{ "font-size": "18px", "font-weight": "700", color: "var(--vscode-foreground)" }}>
                  {health().totalRequests}
                </div>
                <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Total Requests</div>
              </div>
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--vscode-textBlockQuote-background)",
                  "border-radius": "4px",
                  "text-align": "center",
                }}
              >
                <div style={{ "font-size": "18px", "font-weight": "700", color: "var(--vscode-testing-iconFailed)" }}>
                  {health().totalFailures}
                </div>
                <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Total Failures</div>
              </div>
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--vscode-textBlockQuote-background)",
                  "border-radius": "4px",
                  "text-align": "center",
                }}
              >
                <div style={{ "font-size": "18px", "font-weight": "700", color: "var(--vscode-foreground)" }}>
                  ${health().totalCost.toFixed(4)}
                </div>
                <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                  Estimated Cost
                </div>
              </div>
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--vscode-textBlockQuote-background)",
                  "border-radius": "4px",
                  "text-align": "center",
                }}
              >
                <div
                  style={{
                    "font-size": "18px",
                    "font-weight": "700",
                    color: "var(--vscode-editorWarning-foreground)",
                  }}
                >
                  {health().totalWrongRoleBlocks}
                </div>
                <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                  Wrong-Role Blocks
                </div>
              </div>
            </div>

            {/* Provider health status bar */}
            <SettingsRow title="Provider Health Distribution" description="Request distribution across providers">
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  height: "20px",
                  "border-radius": "4px",
                  overflow: "hidden",
                  border: "1px solid var(--vscode-panel-border)",
                }}
              >
                <Show
                  when={health().totalRequests > 0}
                  fallback={
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        "font-size": "10px",
                        color: "var(--vscode-descriptionForeground)",
                        background: "var(--vscode-textBlockQuote-background)",
                      }}
                    >
                      No requests yet
                    </div>
                  }
                >
                  <For each={providers()}>
                    {(p, i) => {
                      const colors = [
                        "var(--vscode-charts-blue)",
                        "var(--vscode-charts-orange)",
                        "var(--vscode-charts-green)",
                        "var(--vscode-charts-red)",
                        "var(--vscode-charts-purple)",
                      ]
                      return (
                        <BarSegment
                          value={p.requestCount}
                          total={health().totalRequests}
                          color={colors[i() % colors.length]}
                          label={p.name}
                        />
                      )
                    }}
                  </For>
                </Show>
              </div>
            </SettingsRow>

            {/* Per-provider details */}
            <div style={{ "margin-top": "8px" }}>
              <div
                style={{
                  "font-size": "12px",
                  "font-weight": "600",
                  "margin-bottom": "6px",
                  color: "var(--vscode-foreground)",
                }}
              >
                Per-Provider Breakdown
              </div>
              <table
                style={{
                  width: "100%",
                  "border-collapse": "collapse",
                  "font-size": "12px",
                }}
              >
                <thead>
                  <tr>
                    <For
                      each={["Provider", "Status", "Circuit Breaker", "Requests", "Failures", "Cost"]}
                    >
                      {(header) => (
                        <th
                          style={{
                            "text-align": "left",
                            padding: "4px 8px",
                            "border-bottom": "2px solid var(--vscode-panel-border)",
                            "font-weight": "600",
                            "white-space": "nowrap",
                          }}
                        >
                          {header}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={providers()}>
                    {(p) => (
                      <tr>
                        <td
                          style={{
                            padding: "4px 8px",
                            "border-bottom": "1px solid var(--vscode-panel-border)",
                            "font-weight": "500",
                          }}
                        >
                          {p.name}
                        </td>
                        <td
                          style={{
                            padding: "4px 8px",
                            "border-bottom": "1px solid var(--vscode-panel-border)",
                          }}
                        >
                          <StatusBadge status={p.status} />
                        </td>
                        <td
                          style={{
                            padding: "4px 8px",
                            "border-bottom": "1px solid var(--vscode-panel-border)",
                          }}
                        >
                          <CircuitBadge state={p.circuitBreaker} />
                        </td>
                        <td
                          style={{
                            padding: "4px 8px",
                            "border-bottom": "1px solid var(--vscode-panel-border)",
                          }}
                        >
                          {p.requestCount}
                        </td>
                        <td
                          style={{
                            padding: "4px 8px",
                            "border-bottom": "1px solid var(--vscode-panel-border)",
                            color:
                              p.failureCount > 0
                                ? "var(--vscode-testing-iconFailed)"
                                : "var(--vscode-foreground)",
                          }}
                        >
                          {p.failureCount}
                        </td>
                        <td
                          style={{
                            padding: "4px 8px",
                            "border-bottom": "1px solid var(--vscode-panel-border)",
                          }}
                        >
                          ${p.estimatedCost.toFixed(4)}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Show>
      </Card>

      {/* ── Routing Configuration ─────────────────────────── */}
      <Card>
        <div style={sectionHeaderStyle(true)} onClick={() => setConfigOpen((v) => !v)}>
          <span>{configOpen() ? "\u25BE" : "\u25B8"} Routing Configuration</span>
        </div>

        <Show when={configOpen()}>
          <div style={{ padding: "0 12px 12px" }}>
            {/* Routing Mode */}
            <SettingsRow title="Routing Mode" description="Auto mode selects providers based on task type and risk level. Manual mode uses your fallback order.">
              <div style={{ display: "flex", gap: "8px" }}>
                <Button
                  variant={config().mode === "auto" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => setMode("auto")}
                >
                  Auto
                </Button>
                <Button
                  variant={config().mode === "manual" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => setMode("manual")}
                >
                  Manual
                </Button>
              </div>
            </SettingsRow>

            {/* Privacy Mode */}
            <SettingsRow
              title="Privacy Mode"
              description="When set to local preferred, routing will favor Ollama and LM Studio over cloud providers."
            >
              <Switch
                checked={config().privacyMode === "local_preferred"}
                onChange={(checked) => setPrivacy(checked ? "local_preferred" : "cloud_ok")}
                hideLabel
              >
                Local preferred
              </Switch>
            </SettingsRow>

            {/* Cost Threshold */}
            <SettingsRow
              title="Cost Threshold Alert"
              description="Alert when estimated cost per provider exceeds this amount (USD). Set to 0 to disable."
            >
              <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                <span style={{ "font-size": "13px", color: "var(--vscode-foreground)" }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={config().costThreshold}
                  onInput={(e) => setCostThreshold(parseFloat(e.currentTarget.value) || 0)}
                  onBlur={saveCostThreshold}
                  style={{ ...inputStyle, width: "100px" }}
                />
              </div>
            </SettingsRow>

            {/* Fallback Chain */}
            <SettingsRow title="Fallback Chain Order" description="Providers are tried in this order when the primary selection is unavailable.">
              <div style={{ width: "100%" }}>
                <Show
                  when={!editingFallback()}
                  fallback={
                    <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
                      <For each={config().fallbackOrder}>
                        {(pid, index) => (
                          <div
                            style={{
                              display: "flex",
                              "align-items": "center",
                              gap: "6px",
                              padding: "4px 8px",
                              background: "var(--vscode-textBlockQuote-background)",
                              "border-radius": "4px",
                              "font-size": "12px",
                            }}
                          >
                            <span
                              style={{
                                width: "18px",
                                "text-align": "center",
                                "font-weight": "600",
                                color: "var(--vscode-descriptionForeground)",
                              }}
                            >
                              {index() + 1}.
                            </span>
                            <span style={{ flex: "1" }}>{providerName(pid)}</span>
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() => moveFallback(index(), "up")}
                              disabled={index() === 0}
                            >
                              {"\u25B2"}
                            </Button>
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() => moveFallback(index(), "down")}
                              disabled={index() === config().fallbackOrder.length - 1}
                            >
                              {"\u25BC"}
                            </Button>
                          </div>
                        )}
                      </For>
                      <div style={{ "margin-top": "4px" }}>
                        <Button variant="secondary" size="small" onClick={() => setEditingFallback(false)}>
                          Done
                        </Button>
                      </div>
                    </div>
                  }
                >
                  <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                    <span
                      style={{
                        "font-size": "12px",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      {config()
                        .fallbackOrder.map((id, i) => `${i + 1}. ${providerName(id)}`)
                        .join("  ")}
                    </span>
                    <Button variant="secondary" size="small" onClick={() => setEditingFallback(true)}>
                      Reorder
                    </Button>
                  </div>
                </Show>
              </div>
            </SettingsRow>
          </div>
        </Show>
      </Card>
    </div>
  )
}

export default RoutingTab
