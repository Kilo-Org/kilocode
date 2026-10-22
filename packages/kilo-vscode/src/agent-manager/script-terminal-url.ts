export interface PtyServerConfig {
  baseUrl: string
  password: string
}

/** Build the canonical authenticated PTY WebSocket URL for script terminals. */
export function buildScriptTerminalWsUrl(config: PtyServerConfig, ptyID: string, cwd: string): string {
  const base = config.baseUrl.replace(/^http/i, "ws").replace(/\/$/, "")
  const token = Buffer.from(`kilo:${config.password}`).toString("base64")
  const query = new URLSearchParams({
    "location[directory]": cwd,
    cursor: "0",
    replayExited: "1",
    auth_token: token,
  })
  return `${base}/api/pty/${encodeURIComponent(ptyID)}/connect?${query.toString()}`
}
