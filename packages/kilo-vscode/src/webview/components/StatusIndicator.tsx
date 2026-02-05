import { useServer } from "../context/server"

export function StatusIndicator() {
  const { server, status } = useServer()

  const statusText = () => {
    const s = status()
    if (s === "connected") {
      const info = server()
      return info ? `Connected (v${info.version})` : "Connected"
    }
    if (s === "connecting") return "Connecting..."
    return "Disconnected"
  }

  const statusColor = () => {
    const s = status()
    if (s === "connected") return "var(--vscode-testing-iconPassed)"
    if (s === "connecting") return "var(--vscode-testing-iconQueued)"
    return "var(--vscode-testing-iconFailed)"
  }

  return (
    <div class="status-indicator">
      <span class="status-dot" style={{ "background-color": statusColor() }} />
      <span class="status-text">{statusText()}</span>
    </div>
  )
}
