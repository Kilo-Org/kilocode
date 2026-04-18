import { Component, createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useVSCode } from "../../context/vscode"
import SettingsRow from "./SettingsRow"

// ─── Types ───────────────────────────────────────────────

interface VPSServer {
  id: string
  hostname: string
  ip: string
  sshProfile: string
  os: string
  region: string
  tags: string[]
  status: "online" | "offline" | "degraded" | "unknown"
}

interface VPSMetrics {
  serverId: string
  cpu: number
  ramUsed: number
  ramTotal: number
  disks: Array<{ mount: string; used: number; total: number }>
  timestamp: number
}

interface ServiceInfo {
  name: string
  status: "running" | "stopped" | "failed"
  pid: number
  cpuPercent: number
  memPercent: number
}

interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  ports: string[]
}

interface DeployEntry {
  id: string
  timestamp: number
  action: string
  status: "success" | "failed" | "in-progress"
  rollbackAvailable: boolean
}

// ─── Styles ──────────────────────────────────────────────

const inputStyle = {
  width: "100%",
  padding: "4px 8px",
  border: "1px solid var(--vscode-input-border)",
  background: "var(--vscode-input-background)",
  color: "var(--vscode-input-foreground)",
  "border-radius": "2px",
  "font-size": "13px",
  "box-sizing": "border-box" as const,
}

const sectionHeaderStyle = (clickable: boolean) => ({
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "8px 12px",
  cursor: clickable ? "pointer" : "default",
  "user-select": "none" as const,
  "font-weight": "600",
  "font-size": "13px",
})

const badgeStyle = (status: string) => {
  const colors: Record<string, string> = {
    online: "var(--vscode-testing-iconPassed)",
    running: "var(--vscode-testing-iconPassed)",
    success: "var(--vscode-testing-iconPassed)",
    offline: "var(--vscode-testing-iconFailed)",
    stopped: "var(--vscode-testing-iconFailed)",
    failed: "var(--vscode-testing-iconFailed)",
    degraded: "var(--vscode-editorWarning-foreground)",
    "in-progress": "var(--vscode-editorInfo-foreground)",
    unknown: "var(--vscode-descriptionForeground)",
  }
  return {
    display: "inline-flex",
    "align-items": "center",
    gap: "4px",
    padding: "1px 8px",
    "border-radius": "10px",
    "font-size": "11px",
    "font-weight": "500",
    background: "var(--vscode-badge-background)",
    color: colors[status] ?? "var(--vscode-descriptionForeground)",
    border: `1px solid ${colors[status] ?? "var(--vscode-panel-border)"}`,
  }
}

const rowButtonStyle = {
  padding: "2px 8px",
  "font-size": "11px",
  cursor: "pointer",
  border: "1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border))",
  background: "var(--vscode-button-secondaryBackground)",
  color: "var(--vscode-button-secondaryForeground)",
  "border-radius": "2px",
}

const primaryButtonStyle = {
  ...rowButtonStyle,
  background: "var(--vscode-button-background)",
  color: "var(--vscode-button-foreground)",
  border: "1px solid var(--vscode-button-background)",
}

const dangerButtonStyle = {
  ...rowButtonStyle,
  background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
  color: "var(--vscode-errorForeground)",
  border: "1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground))",
}

const tableStyle = {
  width: "100%",
  "border-collapse": "collapse" as const,
  "font-size": "12px",
}

const thStyle = {
  "text-align": "left" as const,
  padding: "6px 8px",
  "font-weight": "600",
  "font-size": "11px",
  "text-transform": "uppercase" as const,
  "letter-spacing": "0.5px",
  color: "var(--vscode-descriptionForeground)",
  "border-bottom": "1px solid var(--vscode-panel-border)",
}

const tdStyle = {
  padding: "6px 8px",
  "border-bottom": "1px solid var(--vscode-panel-border)",
  "vertical-align": "middle" as const,
}

const tagStyle = {
  display: "inline-block",
  padding: "1px 6px",
  "border-radius": "8px",
  "font-size": "10px",
  background: "var(--vscode-badge-background)",
  color: "var(--vscode-badge-foreground)",
  "margin-right": "4px",
}

// ─── Helpers ─────────────────────────────────────────────

function generateId(): string {
  return `vps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString()
}

function cpuColor(pct: number): string {
  if (pct >= 80) return "var(--vscode-testing-iconFailed)"
  if (pct >= 60) return "var(--vscode-editorWarning-foreground)"
  return "var(--vscode-testing-iconPassed)"
}

function usagePercent(used: number, total: number): number {
  if (total === 0) return 0
  return Math.round((used / total) * 100)
}

// ─── Sub-Components ──────────────────────────────────────

const GaugeBar: Component<{ label: string; value: number; max: number; unit?: string }> = (props) => {
  const pct = () => (props.max > 0 ? Math.round((props.value / props.max) * 100) : 0)
  const color = () => cpuColor(pct())
  return (
    <div style={{ "margin-bottom": "8px" }}>
      <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "2px", "font-size": "12px" }}>
        <span>{props.label}</span>
        <span style={{ color: "var(--vscode-descriptionForeground)" }}>
          {props.unit ? `${formatBytes(props.value)} / ${formatBytes(props.max)}` : `${pct()}%`}
        </span>
      </div>
      <div
        style={{
          height: "6px",
          "border-radius": "3px",
          background: "var(--vscode-progressBar-background, var(--vscode-panel-border))",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(pct(), 100)}%`,
            "border-radius": "3px",
            background: color(),
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  )
}

interface ServerFormData {
  hostname: string
  ip: string
  sshProfile: string
  os: string
  region: string
  tags: string
}

const emptyForm: ServerFormData = {
  hostname: "",
  ip: "",
  sshProfile: "",
  os: "linux",
  region: "",
  tags: "",
}

const OS_OPTIONS = [
  { value: "linux", label: "Linux" },
  { value: "ubuntu", label: "Ubuntu" },
  { value: "debian", label: "Debian" },
  { value: "centos", label: "CentOS" },
  { value: "rhel", label: "RHEL" },
  { value: "alpine", label: "Alpine" },
  { value: "windows", label: "Windows Server" },
  { value: "freebsd", label: "FreeBSD" },
]

const REFRESH_INTERVALS = [
  { value: 5, label: "5 seconds" },
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "60 seconds" },
]

// ─── Main Component ──────────────────────────────────────

const VPSTab: Component = () => {
  const { postMessage, onMessage } = useVSCode()

  // ── State ────────────────────────────────────────────
  const [servers, setServers] = createSignal<VPSServer[]>([])
  const [selectedServerId, setSelectedServerId] = createSignal<string | null>(null)
  const [metrics, setMetrics] = createSignal<VPSMetrics | null>(null)
  const [services, setServices] = createSignal<ServiceInfo[]>([])
  const [containers, setContainers] = createSignal<DockerContainer[]>([])
  const [deployHistory, setDeployHistory] = createSignal<DeployEntry[]>([])
  const [backupStatus, setBackupStatus] = createSignal<"none" | "available" | "in-progress">("none")

  // Form state
  const [showForm, setShowForm] = createSignal(false)
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [form, setForm] = createSignal<ServerFormData>({ ...emptyForm })

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = createSignal(false)
  const [refreshInterval, setRefreshInterval] = createSignal(15)
  let refreshTimer: ReturnType<typeof setInterval> | undefined

  // Section collapse state
  const [inventoryOpen, setInventoryOpen] = createSignal(true)
  const [monitoringOpen, setMonitoringOpen] = createSignal(true)
  const [servicesOpen, setServicesOpen] = createSignal(true)
  const [dockerOpen, setDockerOpen] = createSignal(true)
  const [deployOpen, setDeployOpen] = createSignal(true)

  // Filter state
  const [processFilter, setProcessFilter] = createSignal("")

  // ── Derived ──────────────────────────────────────────
  const selectedServer = () => servers().find((s) => s.id === selectedServerId())

  const filteredServices = () => {
    const q = processFilter().toLowerCase()
    if (!q) return services()
    return services().filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.pid).includes(q) ||
        s.status.toLowerCase().includes(q),
    )
  }

  // ── Message handler ──────────────────────────────────
  const unsubscribe = onMessage((msg) => {
    switch (msg.type) {
      case "vpsServersLoaded":
        setServers(msg.servers as VPSServer[])
        break
      case "vpsMetricsLoaded":
        setMetrics(msg.metrics as VPSMetrics)
        break
      case "vpsServicesLoaded":
        setServices(msg.services as ServiceInfo[])
        break
      case "vpsContainersLoaded":
        setContainers(msg.containers as DockerContainer[])
        break
      case "vpsDeployHistoryLoaded":
        setDeployHistory(msg.history as DeployEntry[])
        break
      case "vpsBackupStatus":
        setBackupStatus(msg.status as "none" | "available" | "in-progress")
        break
      case "vpsServerAdded": {
        const added = msg.server as VPSServer
        setServers((prev) => [...prev, added])
        break
      }
      case "vpsServerUpdated": {
        const updated = msg.server as VPSServer
        setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
        break
      }
      case "vpsServerRemoved": {
        const removedId = msg.serverId as string
        setServers((prev) => prev.filter((s) => s.id !== removedId))
        if (selectedServerId() === removedId) {
          setSelectedServerId(null)
          setMetrics(null)
          setServices([])
          setContainers([])
        }
        break
      }
    }
  })
  onCleanup(unsubscribe)

  // ── Auto-refresh effect ──────────────────────────────
  createEffect(() => {
    if (refreshTimer) clearInterval(refreshTimer)
    if (autoRefresh() && selectedServerId()) {
      refreshTimer = setInterval(() => {
        requestMetrics()
      }, refreshInterval() * 1000)
    }
  })

  onCleanup(() => {
    if (refreshTimer) clearInterval(refreshTimer)
  })

  // ── Request initial data ─────────────────────────────
  postMessage({ type: "requestVpsServers" } as never)

  // ── Actions ──────────────────────────────────────────

  function requestMetrics() {
    const id = selectedServerId()
    if (!id) return
    postMessage({ type: "vpsRefreshMetrics", serverId: id } as never)
  }

  function selectServer(id: string) {
    setSelectedServerId(id)
    requestMetrics()
    postMessage({ type: "vpsRefreshMetrics", serverId: id } as never)
  }

  function openAddForm() {
    setForm({ ...emptyForm })
    setEditingId(null)
    setShowForm(true)
  }

  function openEditForm(server: VPSServer) {
    setForm({
      hostname: server.hostname,
      ip: server.ip,
      sshProfile: server.sshProfile,
      os: server.os,
      region: server.region,
      tags: server.tags.join(", "),
    })
    setEditingId(server.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm({ ...emptyForm })
  }

  function submitForm() {
    const f = form()
    if (!f.hostname.trim() || !f.ip.trim()) return

    const tags = f.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    if (editingId()) {
      postMessage({
        type: "vpsServerAdd",
        server: {
          id: editingId(),
          hostname: f.hostname.trim(),
          ip: f.ip.trim(),
          sshProfile: f.sshProfile.trim(),
          os: f.os,
          region: f.region.trim(),
          tags,
          status: "unknown",
        },
      } as never)
    } else {
      postMessage({
        type: "vpsServerAdd",
        server: {
          id: generateId(),
          hostname: f.hostname.trim(),
          ip: f.ip.trim(),
          sshProfile: f.sshProfile.trim(),
          os: f.os,
          region: f.region.trim(),
          tags,
          status: "unknown",
        },
      } as never)
    }
    cancelForm()
  }

  function removeServer(id: string) {
    postMessage({ type: "vpsServerRemove", serverId: id } as never)
  }

  function connectSSH(server: VPSServer) {
    postMessage({ type: "openExternal", url: `vscode://vscode-remote/ssh-remote+${server.sshProfile || server.ip}/` } as never)
  }

  function serviceAction(serviceName: string, action: "restart" | "stop" | "logs") {
    const id = selectedServerId()
    if (!id) return
    postMessage({ type: "vpsServiceAction", serverId: id, service: serviceName, action } as never)
  }

  function dockerAction(containerId: string, action: "start" | "stop" | "restart" | "remove" | "logs") {
    const id = selectedServerId()
    if (!id) return
    postMessage({ type: "vpsDockerAction", serverId: id, containerId, action } as never)
  }

  function rollbackDeploy(deployId: string) {
    const id = selectedServerId()
    if (!id) return
    postMessage({ type: "vpsRollback", serverId: id, deployId } as never)
  }

  function createBackup() {
    const id = selectedServerId()
    if (!id) return
    postMessage({ type: "vpsBackup", serverId: id } as never)
  }

  function triggerDeploy() {
    const id = selectedServerId()
    if (!id) return
    postMessage({ type: "vpsDeploy", serverId: id } as never)
  }

  // ── Render ───────────────────────────────────────────
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      {/* Info banner */}
      <div
        style={{
          background: "var(--vscode-textBlockQuote-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          padding: "12px 16px",
        }}
      >
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: "0",
            "line-height": "1.5",
          }}
        >
          Manage your VPS inventory, monitor resource usage, control services and Docker containers, and
          track deployments. Connect servers via SSH to enable remote metrics and management.
        </p>
      </div>

      {/* ═══ VPS Inventory ═══ */}
      <Card>
        <div
          style={sectionHeaderStyle(true)}
          onClick={() => setInventoryOpen(!inventoryOpen())}
        >
          <span>{inventoryOpen() ? "\u25BC" : "\u25B6"} Server Inventory</span>
          <Button
            variant="secondary"
            size="small"
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              openAddForm()
            }}
          >
            + Add Server
          </Button>
        </div>

        <Show when={inventoryOpen()}>
          <div style={{ padding: "0 12px 12px" }}>
            {/* Add/Edit Form */}
            <Show when={showForm()}>
              <div
                style={{
                  background: "var(--vscode-editor-background)",
                  border: "1px solid var(--vscode-panel-border)",
                  "border-radius": "4px",
                  padding: "12px",
                  "margin-bottom": "12px",
                }}
              >
                <div style={{ "font-weight": "600", "font-size": "13px", "margin-bottom": "12px" }}>
                  {editingId() ? "Edit Server" : "Add Server"}
                </div>
                <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "8px" }}>
                  <div>
                    <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Hostname *</label>
                    <input
                      type="text"
                      value={form().hostname}
                      onInput={(e) => setForm((f) => ({ ...f, hostname: e.currentTarget.value }))}
                      placeholder="web-server-01"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>IP Address *</label>
                    <input
                      type="text"
                      value={form().ip}
                      onInput={(e) => setForm((f) => ({ ...f, ip: e.currentTarget.value }))}
                      placeholder="192.168.1.100"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>SSH Profile</label>
                    <input
                      type="text"
                      value={form().sshProfile}
                      onInput={(e) => setForm((f) => ({ ...f, sshProfile: e.currentTarget.value }))}
                      placeholder="my-ssh-profile"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>OS Type</label>
                    <select
                      value={form().os}
                      onChange={(e) => setForm((f) => ({ ...f, os: e.currentTarget.value }))}
                      style={{ ...inputStyle, height: "26px" }}
                    >
                      <For each={OS_OPTIONS}>
                        {(opt) => <option value={opt.value}>{opt.label}</option>}
                      </For>
                    </select>
                  </div>
                  <div>
                    <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Region</label>
                    <input
                      type="text"
                      value={form().region}
                      onInput={(e) => setForm((f) => ({ ...f, region: e.currentTarget.value }))}
                      placeholder="us-east-1"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={form().tags}
                      onInput={(e) => setForm((f) => ({ ...f, tags: e.currentTarget.value }))}
                      placeholder="production, web, nginx"
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", "margin-top": "12px", "justify-content": "flex-end" }}>
                  <button style={rowButtonStyle} onClick={cancelForm}>
                    Cancel
                  </button>
                  <button
                    style={{
                      ...primaryButtonStyle,
                      opacity: !form().hostname.trim() || !form().ip.trim() ? "0.5" : "1",
                      cursor: !form().hostname.trim() || !form().ip.trim() ? "not-allowed" : "pointer",
                    }}
                    onClick={submitForm}
                    disabled={!form().hostname.trim() || !form().ip.trim()}
                  >
                    {editingId() ? "Update" : "Add"}
                  </button>
                </div>
              </div>
            </Show>

            {/* Server List */}
            <Show
              when={servers().length > 0}
              fallback={
                <div
                  style={{
                    padding: "24px",
                    "text-align": "center",
                    color: "var(--vscode-descriptionForeground)",
                    "font-size": "12px",
                  }}
                >
                  No servers registered. Click "Add Server" to get started.
                </div>
              }
            >
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Hostname</th>
                    <th style={thStyle}>IP Address</th>
                    <th style={thStyle}>OS</th>
                    <th style={thStyle}>Region</th>
                    <th style={thStyle}>Tags</th>
                    <th style={thStyle}>Status</th>
                    <th style={{ ...thStyle, "text-align": "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={servers()}>
                    {(server) => (
                      <tr
                        style={{
                          background:
                            selectedServerId() === server.id
                              ? "var(--vscode-list-activeSelectionBackground)"
                              : "transparent",
                          color:
                            selectedServerId() === server.id
                              ? "var(--vscode-list-activeSelectionForeground)"
                              : "inherit",
                          cursor: "pointer",
                        }}
                        onClick={() => selectServer(server.id)}
                      >
                        <td style={{ ...tdStyle, "font-weight": "500" }}>{server.hostname}</td>
                        <td style={{ ...tdStyle, "font-family": "var(--vscode-editor-font-family)" }}>
                          {server.ip}
                        </td>
                        <td style={tdStyle}>{server.os}</td>
                        <td style={tdStyle}>{server.region || "--"}</td>
                        <td style={tdStyle}>
                          <For each={server.tags}>
                            {(tag) => <span style={tagStyle}>{tag}</span>}
                          </For>
                          <Show when={server.tags.length === 0}>
                            <span style={{ color: "var(--vscode-descriptionForeground)" }}>--</span>
                          </Show>
                        </td>
                        <td style={tdStyle}>
                          <span style={badgeStyle(server.status)}>
                            {server.status}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, "text-align": "right" }}>
                          <div style={{ display: "flex", gap: "4px", "justify-content": "flex-end" }}>
                            <button
                              style={rowButtonStyle}
                              title="Connect via SSH"
                              onClick={(e: MouseEvent) => {
                                e.stopPropagation()
                                connectSSH(server)
                              }}
                            >
                              SSH
                            </button>
                            <button
                              style={rowButtonStyle}
                              title="Edit server"
                              onClick={(e: MouseEvent) => {
                                e.stopPropagation()
                                openEditForm(server)
                              }}
                            >
                              Edit
                            </button>
                            <button
                              style={dangerButtonStyle}
                              title="Remove server"
                              onClick={(e: MouseEvent) => {
                                e.stopPropagation()
                                removeServer(server.id)
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>
        </Show>
      </Card>

      {/* ═══ Resource Monitoring ═══ */}
      <Show when={selectedServer()}>
        <Card>
          <div
            style={sectionHeaderStyle(true)}
            onClick={() => setMonitoringOpen(!monitoringOpen())}
          >
            <span>
              {monitoringOpen() ? "\u25BC" : "\u25B6"} Resource Monitoring
              <span
                style={{
                  "font-weight": "400",
                  "font-size": "11px",
                  color: "var(--vscode-descriptionForeground)",
                  "margin-left": "8px",
                }}
              >
                {selectedServer()!.hostname}
              </span>
            </span>
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <Button variant="secondary" size="small" onClick={() => requestMetrics()}>
                Refresh
              </Button>
            </div>
          </div>

          <Show when={monitoringOpen()}>
            <div style={{ padding: "0 12px 12px" }}>
              {/* Auto-refresh controls */}
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "12px",
                  "margin-bottom": "12px",
                  padding: "8px",
                  background: "var(--vscode-editor-background)",
                  "border-radius": "4px",
                }}
              >
                <Switch
                  checked={autoRefresh()}
                  onChange={(checked: boolean) => setAutoRefresh(checked)}
                  hideLabel
                >
                  Auto-refresh
                </Switch>
                <span style={{ "font-size": "12px" }}>Auto-refresh</span>
                <Show when={autoRefresh()}>
                  <select
                    value={refreshInterval()}
                    onChange={(e) => setRefreshInterval(Number(e.currentTarget.value))}
                    style={{ ...inputStyle, width: "auto" }}
                  >
                    <For each={REFRESH_INTERVALS}>
                      {(opt) => <option value={opt.value}>{opt.label}</option>}
                    </For>
                  </select>
                </Show>
              </div>

              <Show
                when={metrics()}
                fallback={
                  <div
                    style={{
                      padding: "24px",
                      "text-align": "center",
                      color: "var(--vscode-descriptionForeground)",
                      "font-size": "12px",
                    }}
                  >
                    No metrics available. Click "Refresh" to fetch metrics.
                  </div>
                }
              >
                {(m) => (
                  <>
                    {/* CPU Gauge */}
                    <GaugeBar label="CPU Usage" value={m().cpu} max={100} />

                    {/* RAM Gauge */}
                    <GaugeBar label="RAM Usage" value={m().ramUsed} max={m().ramTotal} unit="bytes" />

                    {/* Disk Gauges */}
                    <Show when={m().disks.length > 0}>
                      <div
                        style={{
                          "font-size": "12px",
                          "font-weight": "600",
                          "margin-top": "8px",
                          "margin-bottom": "4px",
                        }}
                      >
                        Disk Usage
                      </div>
                      <For each={m().disks}>
                        {(disk) => (
                          <GaugeBar
                            label={disk.mount}
                            value={disk.used}
                            max={disk.total}
                            unit="bytes"
                          />
                        )}
                      </For>
                    </Show>

                    <div
                      style={{
                        "font-size": "10px",
                        color: "var(--vscode-descriptionForeground)",
                        "margin-top": "4px",
                        "text-align": "right",
                      }}
                    >
                      Last updated: {formatTimestamp(m().timestamp)}
                    </div>
                  </>
                )}
              </Show>
            </div>
          </Show>
        </Card>

        {/* ═══ Service & Process Management ═══ */}
        <Card>
          <div
            style={sectionHeaderStyle(true)}
            onClick={() => setServicesOpen(!servicesOpen())}
          >
            <span>{servicesOpen() ? "\u25BC" : "\u25B6"} Services & Processes</span>
          </div>

          <Show when={servicesOpen()}>
            <div style={{ padding: "0 12px 12px" }}>
              {/* Process filter */}
              <div style={{ "margin-bottom": "8px" }}>
                <input
                  type="text"
                  value={processFilter()}
                  onInput={(e) => setProcessFilter(e.currentTarget.value)}
                  placeholder="Filter services by name, PID, or status..."
                  style={inputStyle}
                />
              </div>

              <Show
                when={filteredServices().length > 0}
                fallback={
                  <div
                    style={{
                      padding: "16px",
                      "text-align": "center",
                      color: "var(--vscode-descriptionForeground)",
                      "font-size": "12px",
                    }}
                  >
                    {services().length === 0
                      ? "No services loaded. Refresh metrics to fetch service data."
                      : "No services match your filter."}
                  </div>
                }
              >
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Service</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>PID</th>
                      <th style={thStyle}>CPU%</th>
                      <th style={thStyle}>MEM%</th>
                      <th style={{ ...thStyle, "text-align": "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={filteredServices()}>
                      {(svc) => (
                        <tr>
                          <td style={{ ...tdStyle, "font-weight": "500" }}>{svc.name}</td>
                          <td style={tdStyle}>
                            <span style={badgeStyle(svc.status)}>{svc.status}</span>
                          </td>
                          <td style={{ ...tdStyle, "font-family": "var(--vscode-editor-font-family)" }}>
                            {svc.pid || "--"}
                          </td>
                          <td style={tdStyle}>
                            <span style={{ color: cpuColor(svc.cpuPercent) }}>
                              {svc.cpuPercent.toFixed(1)}%
                            </span>
                          </td>
                          <td style={tdStyle}>{svc.memPercent.toFixed(1)}%</td>
                          <td style={{ ...tdStyle, "text-align": "right" }}>
                            <div style={{ display: "flex", gap: "4px", "justify-content": "flex-end" }}>
                              <button style={rowButtonStyle} onClick={() => serviceAction(svc.name, "restart")}>
                                Restart
                              </button>
                              <button style={rowButtonStyle} onClick={() => serviceAction(svc.name, "stop")}>
                                Stop
                              </button>
                              <button style={rowButtonStyle} onClick={() => serviceAction(svc.name, "logs")}>
                                Logs
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>
          </Show>
        </Card>

        {/* ═══ Docker Containers ═══ */}
        <Card>
          <div
            style={sectionHeaderStyle(true)}
            onClick={() => setDockerOpen(!dockerOpen())}
          >
            <span>{dockerOpen() ? "\u25BC" : "\u25B6"} Docker Containers</span>
          </div>

          <Show when={dockerOpen()}>
            <div style={{ padding: "0 12px 12px" }}>
              <Show
                when={containers().length > 0}
                fallback={
                  <div
                    style={{
                      padding: "16px",
                      "text-align": "center",
                      color: "var(--vscode-descriptionForeground)",
                      "font-size": "12px",
                    }}
                  >
                    No Docker containers found. Refresh metrics to fetch container data.
                  </div>
                }
              >
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Image</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Ports</th>
                      <th style={{ ...thStyle, "text-align": "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={containers()}>
                      {(ct) => {
                        const isRunning = () => ct.status.toLowerCase().includes("up")
                        return (
                          <tr>
                            <td style={{ ...tdStyle, "font-weight": "500" }}>{ct.name}</td>
                            <td
                              style={{
                                ...tdStyle,
                                "font-family": "var(--vscode-editor-font-family)",
                                "font-size": "11px",
                              }}
                            >
                              {ct.image}
                            </td>
                            <td style={tdStyle}>
                              <span style={badgeStyle(isRunning() ? "running" : "stopped")}>
                                {ct.status}
                              </span>
                            </td>
                            <td style={{ ...tdStyle, "font-family": "var(--vscode-editor-font-family)", "font-size": "11px" }}>
                              {ct.ports.length > 0 ? ct.ports.join(", ") : "--"}
                            </td>
                            <td style={{ ...tdStyle, "text-align": "right" }}>
                              <div style={{ display: "flex", gap: "4px", "justify-content": "flex-end", "flex-wrap": "wrap" }}>
                                <Show when={!isRunning()}>
                                  <button style={rowButtonStyle} onClick={() => dockerAction(ct.id, "start")}>
                                    Start
                                  </button>
                                </Show>
                                <Show when={isRunning()}>
                                  <button style={rowButtonStyle} onClick={() => dockerAction(ct.id, "stop")}>
                                    Stop
                                  </button>
                                </Show>
                                <button style={rowButtonStyle} onClick={() => dockerAction(ct.id, "restart")}>
                                  Restart
                                </button>
                                <button style={rowButtonStyle} onClick={() => dockerAction(ct.id, "logs")}>
                                  Logs
                                </button>
                                <button style={dangerButtonStyle} onClick={() => dockerAction(ct.id, "remove")}>
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      }}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>
          </Show>
        </Card>

        {/* ═══ Deploy & Recovery ═══ */}
        <Card>
          <div
            style={sectionHeaderStyle(true)}
            onClick={() => setDeployOpen(!deployOpen())}
          >
            <span>{deployOpen() ? "\u25BC" : "\u25B6"} Deploy & Recovery</span>
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <Show when={backupStatus() === "available"}>
                <span style={badgeStyle("success")}>Backup Available</span>
              </Show>
              <Show when={backupStatus() === "in-progress"}>
                <span style={badgeStyle("in-progress")}>Backup In Progress</span>
              </Show>
              <Show when={backupStatus() === "none"}>
                <span style={badgeStyle("unknown")}>No Backup</span>
              </Show>
            </div>
          </div>

          <Show when={deployOpen()}>
            <div style={{ padding: "0 12px 12px" }}>
              {/* Action buttons */}
              <div style={{ display: "flex", gap: "8px", "margin-bottom": "12px" }}>
                <Button variant="secondary" size="small" onClick={() => triggerDeploy()}>
                  Deploy
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => createBackup()}
                  disabled={backupStatus() === "in-progress"}
                >
                  {backupStatus() === "in-progress" ? "Backing up..." : "Create Backup"}
                </Button>
              </div>

              {/* Deploy History */}
              <Show
                when={deployHistory().length > 0}
                fallback={
                  <div
                    style={{
                      padding: "16px",
                      "text-align": "center",
                      color: "var(--vscode-descriptionForeground)",
                      "font-size": "12px",
                    }}
                  >
                    No deployment history recorded.
                  </div>
                }
              >
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Timestamp</th>
                      <th style={thStyle}>Action</th>
                      <th style={thStyle}>Status</th>
                      <th style={{ ...thStyle, "text-align": "right" }}>Rollback</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={deployHistory()}>
                      {(entry) => (
                        <tr>
                          <td style={{ ...tdStyle, "font-family": "var(--vscode-editor-font-family)", "font-size": "11px" }}>
                            {formatTimestamp(entry.timestamp)}
                          </td>
                          <td style={tdStyle}>{entry.action}</td>
                          <td style={tdStyle}>
                            <span style={badgeStyle(entry.status)}>{entry.status}</span>
                          </td>
                          <td style={{ ...tdStyle, "text-align": "right" }}>
                            <Show when={entry.rollbackAvailable}>
                              <button
                                style={rowButtonStyle}
                                onClick={() => rollbackDeploy(entry.id)}
                              >
                                Rollback
                              </button>
                            </Show>
                            <Show when={!entry.rollbackAvailable}>
                              <span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "11px" }}>--</span>
                            </Show>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>
          </Show>
        </Card>
      </Show>

      {/* No-server-selected placeholder */}
      <Show when={!selectedServer() && servers().length > 0}>
        <div
          style={{
            padding: "32px",
            "text-align": "center",
            color: "var(--vscode-descriptionForeground)",
            "font-size": "13px",
          }}
        >
          Select a server from the inventory above to view monitoring, services, and deployment controls.
        </div>
      </Show>
    </div>
  )
}

export default VPSTab
