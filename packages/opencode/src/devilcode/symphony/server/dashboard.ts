import type { OrchestratorSnapshot } from "../orchestrator"

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(2)}M`
}

export function renderDashboard(state: OrchestratorSnapshot): string {
  const now = Date.now()

  const runningRows = state.running
    .map(
      (r) => `
    <tr>
      <td><strong>${escapeHtml(r.identifier)}</strong></td>
      <td>${escapeHtml(r.state)}</td>
      <td>${r.turnCount}</td>
      <td>${formatDuration(now - r.startedAt)}</td>
      <td>${formatDuration(now - r.lastEventAt)} ago</td>
      <td>${formatTokens(r.tokens.input)} / ${formatTokens(r.tokens.output)} / ${formatTokens(r.tokens.total)}</td>
      <td><code>${escapeHtml(r.sessionId)}</code></td>
    </tr>`,
    )
    .join("")

  const retryRows = state.retrying
    .map(
      (r) => `
    <tr>
      <td><strong>${escapeHtml(r.identifier)}</strong></td>
      <td>${r.attempt}</td>
      <td>${formatDuration(Math.max(0, r.dueAt - now))}</td>
      <td>${escapeHtml(r.error)}</td>
    </tr>`,
    )
    .join("")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Symphony Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0d1117; color: #c9d1d9; padding: 24px; }
    h1 { color: #58a6ff; margin-bottom: 8px; font-size: 24px; }
    .meta { color: #8b949e; margin-bottom: 24px; font-size: 14px; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; min-width: 140px; }
    .stat-value { font-size: 28px; font-weight: 600; color: #58a6ff; }
    .stat-label { font-size: 12px; color: #8b949e; margin-top: 4px; }
    h2 { color: #c9d1d9; margin: 24px 0 12px; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
    th { background: #21262d; color: #8b949e; text-align: left; padding: 8px 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    td { padding: 8px 12px; border-top: 1px solid #21262d; font-size: 14px; }
    code { background: #21262d; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
    .empty { color: #8b949e; padding: 24px; text-align: center; }
    .refresh { color: #58a6ff; text-decoration: none; cursor: pointer; border: 1px solid #30363d; padding: 6px 12px; border-radius: 6px; font-size: 14px; background: #21262d; }
    .refresh:hover { background: #30363d; }
  </style>
</head>
<body>
  <h1>Symphony Dashboard</h1>
  <div class="meta">
    Generated: ${escapeHtml(state.generatedAt)} &nbsp;|&nbsp;
    <button class="refresh" onclick="fetch('/symphony/refresh',{method:'POST'}).then(()=>location.reload())">Refresh Now</button>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${state.counts.running}</div>
      <div class="stat-label">Running</div>
    </div>
    <div class="stat">
      <div class="stat-value">${state.counts.retrying}</div>
      <div class="stat-label">Retrying</div>
    </div>
    <div class="stat">
      <div class="stat-value">${formatTokens(state.tokenTotals.totalTokens)}</div>
      <div class="stat-label">Total Tokens</div>
    </div>
    <div class="stat">
      <div class="stat-value">${formatDuration(state.tokenTotals.secondsRunning * 1000)}</div>
      <div class="stat-label">Total Runtime</div>
    </div>
  </div>

  <h2>Running Agents</h2>
  ${
    state.running.length === 0
      ? '<div class="empty">No agents currently running</div>'
      : `<table>
    <thead><tr><th>Issue</th><th>State</th><th>Turns</th><th>Elapsed</th><th>Last Event</th><th>Tokens (in/out/total)</th><th>Session</th></tr></thead>
    <tbody>${runningRows}</tbody>
  </table>`
  }

  <h2>Retry Queue</h2>
  ${
    state.retrying.length === 0
      ? '<div class="empty">No issues in retry queue</div>'
      : `<table>
    <thead><tr><th>Issue</th><th>Attempt</th><th>Next Retry</th><th>Error</th></tr></thead>
    <tbody>${retryRows}</tbody>
  </table>`
  }

  <script>setTimeout(() => location.reload(), 10000)</script>
</body>
</html>`
}
