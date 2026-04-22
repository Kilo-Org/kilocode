/**
 * HermesTab — Settings tab for the Hermes orchestration pipeline.
 *
 * Features:
 *  - Enable / disable toggle
 *  - Bridge URL configuration
 *  - Approval mode selector
 *  - Live health indicator (ping on demand + auto-refresh)
 *  - API key management (store / clear)
 *  - Agent-Assist panel: Hermes + ZeroClaw help fill/audit all settings
 *  - Active task tracker with state machine display
 */

import { Component, createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { useVSCode } from "../../context/vscode"

// ── Types ────────────────────────────────────────────────────────────────────

type ApprovalMode = "auto-all" | "auto-low" | "manual"

interface HermesStatus {
  enabled: boolean
  baseUrl: string
  approvalMode: ApprovalMode
  workspaceScopeOnly: boolean
  reachable: boolean
  latency_ms: number
  version?: string
  keySource: "secret" | "env" | "none"
  error?: string
}

interface AgentTask {
  task_id: string
  state: string
  description: string
  created_at: string
  summary?: string
  error?: string
}

interface AgentAssistResult {
  filled: string[]
  failed: string[]
  suggestions: string[]
  auditFindings: string[]
}

// ── Component ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
const HermesTab: Component = () => {
  const vscode = useVSCode()

  // ── State ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = createSignal<HermesStatus | null>(null)
  const [pinging, setPinging] = createSignal(false)
  const [toggling, setToggling] = createSignal(false)
  const [savingKey, setSavingKey] = createSignal(false)
  const [apiKeyInput, setApiKeyInput] = createSignal("")
  const [urlInput, setUrlInput] = createSignal("")
  const [urlDirty, setUrlDirty] = createSignal(false)
  const [approvalMode, setApprovalMode] = createSignal<ApprovalMode>("auto-low")
  const [approvalDirty, setApprovalDirty] = createSignal(false)
  const [tasks, setTasks] = createSignal<AgentTask[]>([])
  const [assistRunning, setAssistRunning] = createSignal(false)
  const [assistResult, setAssistResult] = createSignal<AgentAssistResult | null>(null)
  const [agentPrompt, setAgentPrompt] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // ── Load status on mount ───────────────────────────────────────────────────
  const requestStatus = () => {
    vscode.postMessage({ type: "requestHermesStatus" })
  }

  createEffect(() => {
    requestStatus()
    const interval = setInterval(requestStatus, 30_000)
    onCleanup(() => clearInterval(interval))
  })

  // ── Message handler ────────────────────────────────────────────────────────
  const onMessage = (event: MessageEvent) => {
    const msg = event.data as Record<string, unknown>
    switch (msg.type) {
      case "hermesStatusUpdate": {
        const s = msg.status as HermesStatus
        setStatus(s)
        if (!urlDirty()) setUrlInput(s.baseUrl)
        if (!approvalDirty()) setApprovalMode(s.approvalMode)
        setPinging(false)
        break
      }
      case "hermesTasksUpdate": {
        setTasks((msg.tasks as AgentTask[]) ?? [])
        break
      }
      case "hermesAgentAssistResult": {
        setAssistResult(msg.result as AgentAssistResult)
        setAssistRunning(false)
        break
      }
      case "hermesError": {
        setError((msg.message as string) ?? "Unknown error")
        setTimeout(() => setError(null), 5000)
        setToggling(false)
        setPinging(false)
        setSavingKey(false)
        setAssistRunning(false)
        setSubmitting(false)
        break
      }
    }
  }

  createEffect(() => {
    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  // ── Actions ────────────────────────────────────────────────────────────────
  const toggle = () => {
    setToggling(true)
    vscode.postMessage({ type: "hermesToggle" })
  }

  const ping = () => {
    setPinging(true)
    vscode.postMessage({ type: "hermesTestConnection" })
  }

  const saveKey = () => {
    const k = apiKeyInput().trim()
    if (!k) return
    setSavingKey(true)
    vscode.postMessage({ type: "hermesSetApiKey", key: k })
    setApiKeyInput("")
    setTimeout(() => { setSavingKey(false); requestStatus() }, 1200)
  }

  const clearKey = () => {
    vscode.postMessage({ type: "hermesClearApiKey" })
    setTimeout(requestStatus, 800)
  }

  const saveUrl = () => {
    const url = urlInput().trim()
    if (!url) return
    vscode.postMessage({ type: "hermesUpdateConfig", key: "baseUrl", value: url })
    setUrlDirty(false)
    setTimeout(requestStatus, 500)
  }

  const saveApproval = () => {
    vscode.postMessage({ type: "hermesUpdateConfig", key: "approvalMode", value: approvalMode() })
    setApprovalDirty(false)
  }

  const runAgentAssist = () => {
    setAssistRunning(true)
    setAssistResult(null)
    vscode.postMessage({ type: "hermesAgentAssist", mode: "full" })
  }

  const submitTask = () => {
    const desc = agentPrompt().trim()
    if (!desc) return
    setSubmitting(true)
    vscode.postMessage({
      type: "hermesSubmitTask",
      task_type: "research",
      description: desc,
      evidence: [],
      auto_approve: approvalMode() === "auto-all",
    })
    setAgentPrompt("")
    setTimeout(() => { setSubmitting(false); vscode.postMessage({ type: "requestHermesTasks" }) }, 1500)
  }

  const refreshTasks = () => {
    vscode.postMessage({ type: "requestHermesTasks" })
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const stateColor = (state: string) => {
    switch (state) {
      case "completed": return "var(--vscode-testing-iconPassed)"
      case "failed":
      case "rolled_back": return "var(--vscode-testing-iconFailed)"
      case "awaiting_approval": return "var(--vscode-editorWarning-foreground)"
      case "executing_in_zeroclaw": return "var(--vscode-progressBar-background)"
      default: return "var(--vscode-descriptionForeground)"
    }
  }

  const keyBadge = () => {
    const src = status()?.keySource
    if (src === "secret") return { label: "SecretStorage", color: "var(--vscode-testing-iconPassed)" }
    if (src === "env") return { label: "Env Var", color: "var(--vscode-editorWarning-foreground)" }
    return { label: "None", color: "var(--vscode-testing-iconFailed)" }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "18px", padding: "0 4px 24px" }}>

      {/* ── Error banner ── */}
      <Show when={error()}>
        <div style={{
          background: "var(--vscode-inputValidation-errorBackground)",
          border: "1px solid var(--vscode-inputValidation-errorBorder)",
          padding: "8px 12px", "border-radius": "4px",
          color: "var(--vscode-inputValidation-errorForeground)", "font-size": "12px",
        }}>
          ⚠ {error()}
        </div>
      </Show>

      {/* ── Enable / Status row ── */}
      <div style={{ display: "flex", "align-items": "center", gap: "12px", "flex-wrap": "wrap" }}>
        <button
          class="vscode-button"
          onClick={toggle}
          disabled={toggling()}
          style={{
            background: status()?.enabled
              ? "var(--vscode-testing-iconPassed)"
              : "var(--vscode-button-background)",
            color: "var(--vscode-button-foreground)",
            border: "none", padding: "6px 16px", "border-radius": "4px",
            cursor: "pointer", "font-size": "12px", "font-weight": "600",
            opacity: toggling() ? "0.6" : "1",
          }}
        >
          {toggling() ? "…" : status()?.enabled ? "⬤ Pipeline ON" : "○ Pipeline OFF"}
        </button>

        <Show when={status()?.enabled}>
          <button
            class="vscode-button"
            onClick={ping}
            disabled={pinging()}
            style={{
              background: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
              border: "none", padding: "6px 12px", "border-radius": "4px",
              cursor: "pointer", "font-size": "12px",
              opacity: pinging() ? "0.6" : "1",
            }}
          >
            {pinging() ? "Pinging…" : "Test Connection"}
          </button>

          <Show when={status()}>
            <span style={{
              "font-size": "11px",
              color: status()?.reachable ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)",
              "font-weight": "600",
            }}>
              {status()?.reachable ? `✓ Reachable (${status()?.latency_ms}ms)` : "✗ Unreachable"}
            </span>
            <Show when={status()?.version}>
              <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                v{status()?.version}
              </span>
            </Show>
          </Show>
        </Show>
      </div>

      {/* ── Bridge URL ── */}
      <section>
        <label style={{ "font-size": "12px", "font-weight": "600", display: "block", "margin-bottom": "6px" }}>
          Bridge URL
        </label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={urlInput()}
            onInput={(e) => { setUrlInput(e.currentTarget.value); setUrlDirty(true) }}
            placeholder="http://187.77.30.206:18789"
            style={{
              flex: "1", background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
              border: "1px solid var(--vscode-input-border, #555)",
              "border-radius": "3px", padding: "5px 8px", "font-size": "12px",
            }}
          />
          <Show when={urlDirty()}>
            <button
              onClick={saveUrl}
              style={{
                background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)",
                border: "none", padding: "5px 12px", "border-radius": "3px",
                cursor: "pointer", "font-size": "12px",
              }}
            >
              Save
            </button>
          </Show>
        </div>
        <p style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", margin: "4px 0 0" }}>
          Default: Shiba Memory gateway on VPS 187.77.30.206:18789
        </p>
      </section>

      {/* ── Approval mode ── */}
      <section>
        <label style={{ "font-size": "12px", "font-weight": "600", display: "block", "margin-bottom": "6px" }}>
          Approval Mode
        </label>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <select
            value={approvalMode()}
            onChange={(e) => { setApprovalMode(e.currentTarget.value as ApprovalMode); setApprovalDirty(true) }}
            style={{
              background: "var(--vscode-dropdown-background)", color: "var(--vscode-dropdown-foreground)",
              border: "1px solid var(--vscode-dropdown-border)", "border-radius": "3px",
              padding: "5px 8px", "font-size": "12px",
            }}
          >
            <option value="auto-all">Auto Approve All</option>
            <option value="auto-low">Auto Approve Low Risk</option>
            <option value="manual">Manual Approval</option>
          </select>
          <Show when={approvalDirty()}>
            <button
              onClick={saveApproval}
              style={{
                background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)",
                border: "none", padding: "5px 12px", "border-radius": "3px",
                cursor: "pointer", "font-size": "12px",
              }}
            >
              Save
            </button>
          </Show>
        </div>
        <p style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", margin: "4px 0 0" }}>
          auto-low: ZeroClaw auto-executes shell/read tasks; prompts on write/deploy
        </p>
      </section>

      {/* ── API Key ── */}
      <section>
        <label style={{ "font-size": "12px", "font-weight": "600", display: "block", "margin-bottom": "6px" }}>
          API Key&nbsp;
          <span style={{ color: keyBadge().color, "font-weight": "400" }}>
            [{keyBadge().label}]
          </span>
        </label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="password"
            value={apiKeyInput()}
            onInput={(e) => setApiKeyInput(e.currentTarget.value)}
            placeholder="sk-… or MiniMax key"
            style={{
              flex: "1", background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
              border: "1px solid var(--vscode-input-border, #555)",
              "border-radius": "3px", padding: "5px 8px", "font-size": "12px",
            }}
          />
          <button
            onClick={saveKey}
            disabled={savingKey() || !apiKeyInput().trim()}
            style={{
              background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)",
              border: "none", padding: "5px 12px", "border-radius": "3px",
              cursor: "pointer", "font-size": "12px", opacity: savingKey() ? "0.6" : "1",
            }}
          >
            {savingKey() ? "Saving…" : "Store"}
          </button>
          <button
            onClick={clearKey}
            style={{
              background: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)",
              border: "none", padding: "5px 10px", "border-radius": "3px",
              cursor: "pointer", "font-size": "12px",
            }}
          >
            Clear
          </button>
        </div>
        <p style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", margin: "4px 0 0" }}>
          Stored in VS Code SecretStorage. Falls back to HERMES_API_KEY / MINIMAX_API_KEY env vars.
        </p>
      </section>

      {/* ── Agent Assist panel ── */}
      <section style={{
        background: "var(--vscode-editor-inactiveSelectionBackground)",
        "border-radius": "6px", padding: "14px", border: "1px solid var(--vscode-panel-border)",
      }}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "10px" }}>
          <div>
            <span style={{ "font-size": "13px", "font-weight": "700" }}>🤖 Hermes + ZeroClaw Agent Assist</span>
            <p style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", margin: "3px 0 0" }}>
              Agents scan all settings, auto-fill missing API keys, audit config, and flag issues.
            </p>
          </div>
          <button
            onClick={runAgentAssist}
            disabled={assistRunning() || !status()?.enabled}
            style={{
              background: assistRunning() ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)", border: "none",
              padding: "7px 16px", "border-radius": "4px", cursor: "pointer", "font-size": "12px",
              "font-weight": "600", opacity: (!status()?.enabled) ? "0.5" : "1",
            }}
          >
            {assistRunning() ? "⟳ Running…" : "Run Full Audit"}
          </button>
        </div>

        <Show when={!status()?.enabled}>
          <p style={{ "font-size": "11px", color: "var(--vscode-editorWarning-foreground)", margin: "0" }}>
            ⚠ Enable the Hermes pipeline above to use Agent Assist.
          </p>
        </Show>

        <Show when={assistResult()}>
          {(r) => (
            <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
              <Show when={r().filled.length > 0}>
                <div>
                  <div style={{ "font-size": "11px", "font-weight": "600", color: "var(--vscode-testing-iconPassed)", "margin-bottom": "4px" }}>
                    ✓ Auto-filled ({r().filled.length})
                  </div>
                  <For each={r().filled}>
                    {(item) => (
                      <div style={{ "font-size": "11px", color: "var(--vscode-foreground)", padding: "1px 0" }}>
                        • {item}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={r().failed.length > 0}>
                <div>
                  <div style={{ "font-size": "11px", "font-weight": "600", color: "var(--vscode-testing-iconFailed)", "margin-bottom": "4px" }}>
                    ✗ Could not fill ({r().failed.length})
                  </div>
                  <For each={r().failed}>
                    {(item) => (
                      <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", padding: "1px 0" }}>
                        • {item}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={r().auditFindings.length > 0}>
                <div>
                  <div style={{ "font-size": "11px", "font-weight": "600", color: "var(--vscode-editorWarning-foreground)", "margin-bottom": "4px" }}>
                    ⚠ Audit Findings
                  </div>
                  <For each={r().auditFindings}>
                    {(item) => (
                      <div style={{ "font-size": "11px", color: "var(--vscode-foreground)", padding: "1px 0" }}>
                        • {item}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={r().suggestions.length > 0}>
                <div>
                  <div style={{ "font-size": "11px", "font-weight": "600", color: "var(--vscode-textLink-foreground)", "margin-bottom": "4px" }}>
                    💡 Suggestions
                  </div>
                  <For each={r().suggestions}>
                    {(item) => (
                      <div style={{ "font-size": "11px", color: "var(--vscode-foreground)", padding: "1px 0" }}>
                        • {item}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </section>

      {/* ── Submit Research / Audit Task ── */}
      <section>
        <label style={{ "font-size": "12px", "font-weight": "600", display: "block", "margin-bottom": "6px" }}>
          Submit Task to Hermes Agents
        </label>
        <p style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", margin: "0 0 8px" }}>
          Hermes routes to the right agent (researcher, auditor, executor). ZeroClaw runs approved actions.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={agentPrompt()}
            onInput={(e) => setAgentPrompt(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitTask() }}
            placeholder="e.g. Audit all providers, Research best LLM for coding, Fix SSH config…"
            disabled={!status()?.enabled}
            style={{
              flex: "1", background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
              border: "1px solid var(--vscode-input-border, #555)",
              "border-radius": "3px", padding: "5px 8px", "font-size": "12px",
              opacity: !status()?.enabled ? "0.5" : "1",
            }}
          />
          <button
            onClick={submitTask}
            disabled={submitting() || !agentPrompt().trim() || !status()?.enabled}
            style={{
              background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)",
              border: "none", padding: "5px 14px", "border-radius": "3px",
              cursor: "pointer", "font-size": "12px", "font-weight": "600",
              opacity: (submitting() || !status()?.enabled) ? "0.6" : "1",
            }}
          >
            {submitting() ? "…" : "Send"}
          </button>
        </div>
      </section>

      {/* ── Active Tasks ── */}
      <section>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "8px" }}>
          <label style={{ "font-size": "12px", "font-weight": "600" }}>
            Active Tasks ({tasks().length})
          </label>
          <button
            onClick={refreshTasks}
            style={{
              background: "transparent", color: "var(--vscode-textLink-foreground)",
              border: "none", cursor: "pointer", "font-size": "11px", padding: "0",
            }}
          >
            ↻ Refresh
          </button>
        </div>
        <Show
          when={tasks().length > 0}
          fallback={
            <p style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", margin: "0" }}>
              No tasks yet. Submit a task above or run Agent Assist.
            </p>
          }
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <For each={tasks()}>
              {(task) => (
                <div style={{
                  background: "var(--vscode-editor-inactiveSelectionBackground)",
                  "border-radius": "4px", padding: "8px 10px",
                  border: "1px solid var(--vscode-panel-border)",
                }}>
                  <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "3px" }}>
                    <span style={{ "font-size": "11px", "font-weight": "600", color: stateColor(task.state) }}>
                      {task.state.replace(/_/g, " ").toUpperCase()}
                    </span>
                    <span style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)" }}>
                      {task.task_id.slice(0, 8)}…
                    </span>
                  </div>
                  <div style={{ "font-size": "11px", color: "var(--vscode-foreground)" }}>
                    {task.description}
                  </div>
                  <Show when={task.summary}>
                    <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-top": "3px" }}>
                      {task.summary}
                    </div>
                  </Show>
                  <Show when={task.error}>
                    <div style={{ "font-size": "11px", color: "var(--vscode-testing-iconFailed)", "margin-top": "3px" }}>
                      ✗ {task.error}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      {/* ── Pipeline diagram ── */}
      <section style={{
        background: "var(--vscode-textBlockQuote-background)",
        "border-left": "3px solid var(--vscode-textLink-foreground)",
        padding: "10px 14px", "border-radius": "0 4px 4px 0",
      }}>
        <div style={{ "font-size": "11px", "font-weight": "600", "margin-bottom": "6px" }}>
          Pipeline Architecture
        </div>
        <pre style={{
          "font-size": "10px", margin: "0",
          color: "var(--vscode-descriptionForeground)",
          "font-family": "var(--vscode-editor-font-family, monospace)",
          "white-space": "pre",
        }}>
{`KiloCode Webview
    │  POST /tasks
    ▼
Hermes Gateway  (:8091)   ← Bridge A (this tab controls)
    │  route + policy
    ▼
ZeroClaw Service          ← execution sandbox
    │  results + artifacts
    ▼
Hermes (validates)
    │  SSE /tasks/{id}/events
    ▼
KiloCode UI (live state)`}
        </pre>
        <p style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", margin: "8px 0 0" }}>
          KiloCode owns the UI + task envelope. Hermes owns routing, memory, ledger.
          ZeroClaw executes approved actions in an isolated sandbox.
        </p>
      </section>

    </div>
  )
}

export default HermesTab
