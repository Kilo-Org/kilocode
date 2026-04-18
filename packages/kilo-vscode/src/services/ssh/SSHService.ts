import * as fs from "fs"
import * as vscode from "vscode"

// ─── Types ──────────────────────────────────────────────

export type AuthMode = "key" | "password"
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

export interface SSHProfile {
  name: string
  host: string
  port: number
  user: string
  authMode: AuthMode
  keyPath?: string
  jumpHost?: string
  group: string
  labels: string[]
  /** Connection timeout in milliseconds. Defaults to 15000. */
  connectionTimeoutMs?: number
}

export interface SSHSession {
  profileName: string
  status: ConnectionStatus
  terminal?: vscode.Terminal
  lastError?: string
}

export interface RemoteFileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: RemoteFileEntry[]
}

export interface LogTailHandle {
  profileName: string
  service: string
  terminal: vscode.Terminal
  dispose: () => void
}

// ─── Events ─────────────────────────────────────────────

export type SSHEvent =
  | { type: "profilesChanged"; profiles: SSHProfile[] }
  | { type: "sessionsChanged"; sessions: SSHSessionSnapshot[] }
  | { type: "connectionStatus"; profileName: string; status: ConnectionStatus; error?: string }
  | { type: "filesListed"; profileName: string; path: string; entries: RemoteFileEntry[] }
  | { type: "logOutput"; profileName: string; lines: { timestamp: string; text: string }[] }
  | { type: "logTailingStopped"; profileName: string }

export interface SSHSessionSnapshot {
  profileName: string
  status: ConnectionStatus
  lastError?: string
}

// ─── Constants ──────────────────────────────────────────

const SSH_CONFIG_SECTION = "kilo-code.new.ssh"
const SSH_PROFILES_KEY = "profiles"

// ─── Service ────────────────────────────────────────────

export class SSHService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private readonly sessions = new Map<string, SSHSession>()
  private readonly logTails = new Map<string, LogTailHandle>()
  private readonly listeners = new Set<(event: SSHEvent) => void>()
  private readonly reconnectAttempts = new Map<string, number>()
  private readonly outputChannel: vscode.OutputChannel

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel("KiloCode SSH")
    this.disposables.push(this.outputChannel)

    // Watch for terminal close events to update session state
    const terminalCloseWatcher = vscode.window.onDidCloseTerminal((closedTerminal) => {
      Array.from(this.sessions.entries()).some(([name, session]) => {
        if (session.terminal === closedTerminal) {
          session.status = "disconnected"
          session.terminal = undefined
          session.lastError = undefined
          this.emit({ type: "connectionStatus", profileName: name, status: "disconnected" })
          this.emitSessionsChanged()
          return true
        }
        return false
      })
      // Also check log tail terminals
      Array.from(this.logTails.entries()).some(([key, handle]) => {
        if (handle.terminal === closedTerminal) {
          this.logTails.delete(key)
          this.emit({ type: "logTailingStopped", profileName: handle.profileName })
          return true
        }
        return false
      })
    })
    this.disposables.push(terminalCloseWatcher)

    // Watch for config changes
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SSH_CONFIG_SECTION)) {
        this.emit({ type: "profilesChanged", profiles: this.getProfiles() })
      }
    })
    this.disposables.push(configWatcher)

    this.log("SSHService initialized")
  }

  // ─── Event System ───────────────────────────────────────

  onChange(listener: (event: SSHEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: SSHEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event)
      } catch (err) {
        this.log(`Event listener error: ${err}`)
      }
    })
  }

  private emitSessionsChanged(): void {
    this.emit({ type: "sessionsChanged", sessions: this.getSessionSnapshots() })
  }

  // ─── Profile Management ─────────────────────────────────

  getProfiles(): SSHProfile[] {
    const cfg = vscode.workspace.getConfiguration(SSH_CONFIG_SECTION)
    const raw = cfg.get<SSHProfile[]>(SSH_PROFILES_KEY, [])
    // Ensure each profile has required fields with defaults
    return raw.map((p) => ({
      name: p.name ?? "",
      host: p.host ?? "",
      port: p.port ?? 22,
      user: p.user ?? "",
      authMode: p.authMode ?? "key",
      keyPath: p.keyPath,
      jumpHost: p.jumpHost,
      group: p.group ?? "",
      labels: Array.isArray(p.labels) ? p.labels : [],
    }))
  }

  async saveProfile(profile: SSHProfile): Promise<void> {
    const profiles = this.getProfiles()
    const idx = profiles.findIndex((p) => p.name === profile.name)
    if (idx >= 0) {
      profiles[idx] = profile
    } else {
      profiles.push(profile)
    }
    await this.writeProfiles(profiles)
    this.log(`Profile saved: ${profile.name} (${profile.user}@${profile.host}:${profile.port})`)
  }

  async deleteProfile(name: string): Promise<void> {
    // Disconnect if active
    const session = this.sessions.get(name)
    if (session && session.status !== "disconnected") {
      this.disconnect(name)
    }

    const profiles = this.getProfiles().filter((p) => p.name !== name)
    await this.writeProfiles(profiles)
    this.sessions.delete(name)
    this.emitSessionsChanged()
    this.log(`Profile deleted: ${name}`)
  }

  private async writeProfiles(profiles: SSHProfile[]): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(SSH_CONFIG_SECTION)
    await cfg.update(SSH_PROFILES_KEY, profiles, vscode.ConfigurationTarget.Global)
    this.emit({ type: "profilesChanged", profiles })
  }

  // ─── Connection Management ──────────────────────────────

  getSessionSnapshots(): SSHSessionSnapshot[] {
    const snapshots: SSHSessionSnapshot[] = []
    this.sessions.forEach((session) => {
      snapshots.push({
        profileName: String(session.profileName),
        status: session.status,
        lastError: session.lastError !== undefined ? String(session.lastError) : undefined,
      })
    })
    return JSON.parse(JSON.stringify(snapshots)) as SSHSessionSnapshot[]
  }

  getSession(profileName: string): SSHSession | undefined {
    return this.sessions.get(profileName)
  }

  async connect(profileName: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) {
      this.log(`Connect failed: profile "${profileName}" not found`)
      this.emit({
        type: "connectionStatus",
        profileName,
        status: "error",
        error: `Profile "${profileName}" not found`,
      })
      return
    }

    // Validate key file exists when auth mode is "key"
    if (profile.authMode === "key" && profile.keyPath) {
      const resolvedKeyPath = profile.keyPath.replace(/^~/, this.getHomePath())
      if (!fs.existsSync(resolvedKeyPath)) {
        const errorMsg = `SSH key file not found: ${resolvedKeyPath}`
        this.log(`Connect failed: ${errorMsg}`)
        this.emit({
          type: "connectionStatus",
          profileName,
          status: "error",
          error: errorMsg,
        })
        return
      }
    }

    // If already connected, do nothing
    const existing = this.sessions.get(profileName)
    if (existing?.status === "connected" && existing.terminal) {
      existing.terminal.show()
      return
    }

    // Mark as connecting
    const session: SSHSession = {
      profileName,
      status: "connecting",
    }
    this.sessions.set(profileName, session)
    this.emit({ type: "connectionStatus", profileName, status: "connecting" })
    this.emitSessionsChanged()

    try {
      const sshCommand = this.buildSSHCommand(profile)
      const terminal = vscode.window.createTerminal({
        name: `SSH: ${profile.name}`,
        shellPath: this.getShellPath(),
        shellArgs: this.getShellArgs(sshCommand),
        iconPath: new vscode.ThemeIcon("remote"),
      })

      session.terminal = terminal
      session.status = "connected"
      session.lastError = undefined
      terminal.show()

      // Reset reconnect counter on successful connection
      this.reconnectAttempts.delete(profileName)

      this.emit({ type: "connectionStatus", profileName, status: "connected" })
      this.emitSessionsChanged()
      this.log(`Connected: ${profile.name} (${profile.user}@${profile.host}:${profile.port})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      session.status = "error"
      session.lastError = errorMsg
      this.emit({ type: "connectionStatus", profileName, status: "error", error: errorMsg })
      this.emitSessionsChanged()
      this.log(`Connection error for ${profileName}: ${errorMsg}`)
    }
  }

  disconnect(profileName: string): void {
    const session = this.sessions.get(profileName)
    if (!session) return

    if (session.terminal) {
      session.terminal.dispose()
      session.terminal = undefined
    }

    session.status = "disconnected"
    session.lastError = undefined
    this.emit({ type: "connectionStatus", profileName, status: "disconnected" })
    this.emitSessionsChanged()
    this.log(`Disconnected: ${profileName}`)
  }

  /**
   * Disconnect and re-connect to a profile with exponential backoff.
   * Max 3 retries with 2s / 4s / 8s delays. Counter resets on success.
   */
  async reconnect(profileName: string): Promise<void> {
    const maxRetries = 3
    const attempt = this.reconnectAttempts.get(profileName) ?? 0

    if (attempt >= maxRetries) {
      const errorMsg = `Max reconnect attempts (${maxRetries}) reached for "${profileName}"`
      this.log(errorMsg)
      this.emit({
        type: "connectionStatus",
        profileName,
        status: "error",
        error: errorMsg,
      })
      this.reconnectAttempts.delete(profileName)
      return
    }

    this.reconnectAttempts.set(profileName, attempt + 1)
    const backoffMs = Math.pow(2, attempt + 1) * 1000 // 2s, 4s, 8s

    this.log(`Reconnect attempt ${attempt + 1}/${maxRetries} for "${profileName}" (backoff ${backoffMs}ms)`)
    this.disconnect(profileName)

    await new Promise<void>((resolve) => setTimeout(resolve, backoffMs))
    await this.connect(profileName)
  }

  openTerminal(profileName: string): void {
    const session = this.sessions.get(profileName)
    if (session?.terminal) {
      session.terminal.show()
      return
    }

    // If no active terminal but profile exists, create a new connection
    void this.connect(profileName)
  }

  // ─── SSH Command Building ───────────────────────────────

  private buildSSHCommand(profile: SSHProfile): string {
    const parts: string[] = ["ssh"]

    // Disable strict host checking for convenience (user can override in ~/.ssh/config)
    parts.push("-o", "StrictHostKeyChecking=accept-new")
    parts.push("-o", "ServerAliveInterval=30")
    parts.push("-o", "ServerAliveCountMax=3")

    // Connection timeout (convert ms to seconds, default 15s)
    const timeoutSec = Math.ceil((profile.connectionTimeoutMs ?? 15000) / 1000)
    parts.push("-o", `ConnectTimeout=${timeoutSec}`)

    // Port
    if (profile.port !== 22) {
      parts.push("-p", String(profile.port))
    }

    // Key-based auth
    if (profile.authMode === "key" && profile.keyPath) {
      const resolvedPath = profile.keyPath.replace(/^~/, this.getHomePath())
      parts.push("-i", this.quoteArg(resolvedPath))
    }

    // Jump host
    if (profile.jumpHost) {
      parts.push("-J", this.quoteArg(profile.jumpHost))
    }

    // User@Host
    const target = profile.user ? `${profile.user}@${profile.host}` : profile.host
    parts.push(target)

    return parts.join(" ")
  }

  private buildSFTPCommand(profile: SSHProfile): string {
    const parts: string[] = ["sftp"]

    if (profile.port !== 22) {
      parts.push("-P", String(profile.port))
    }

    if (profile.authMode === "key" && profile.keyPath) {
      const resolvedPath = profile.keyPath.replace(/^~/, this.getHomePath())
      parts.push("-i", this.quoteArg(resolvedPath))
    }

    if (profile.jumpHost) {
      parts.push("-J", this.quoteArg(profile.jumpHost))
    }

    const target = profile.user ? `${profile.user}@${profile.host}` : profile.host
    parts.push(target)

    return parts.join(" ")
  }

  private getShellPath(): string {
    const platform = process.platform
    if (platform === "win32") {
      // Use cmd.exe to launch ssh (available on modern Windows)
      return "cmd.exe"
    }
    return "/bin/bash"
  }

  private getShellArgs(command: string): string[] {
    const platform = process.platform
    if (platform === "win32") {
      return ["/c", command]
    }
    return ["-c", command]
  }

  private getHomePath(): string {
    return process.env.HOME ?? process.env.USERPROFILE ?? "~"
  }

  private quoteArg(arg: string): string {
    // If it contains spaces or special chars, wrap in quotes
    if (/[\s"'\\$`!]/.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`
    }
    return arg
  }

  // ─── SFTP File Operations ───────────────────────────────

  async listFiles(profileName: string, remotePath: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) {
      this.log(`SFTP list failed: profile "${profileName}" not found`)
      return
    }

    const normalizedPath = remotePath || "/"
    this.log(`SFTP listing: ${profileName}:${normalizedPath}`)

    try {
      const entries = await this.executeSFTPList(profile, normalizedPath)
      this.emit({
        type: "filesListed",
        profileName,
        path: normalizedPath,
        entries,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log(`SFTP list error for ${profileName}:${normalizedPath}: ${errorMsg}`)
      // Emit empty result with the path so UI can clear the loading state
      this.emit({
        type: "filesListed",
        profileName,
        path: normalizedPath,
        entries: [],
      })
    }
  }

  private async executeSFTPList(profile: SSHProfile, remotePath: string): Promise<RemoteFileEntry[]> {
    // Build an ssh command to list directory contents with markers for parsing
    const sshBase = this.buildSSHCommandBase(profile)
    // Use ls -1paF to get one-entry-per-line, mark dirs with /, skip . and ..
    const listCmd = `${sshBase} "ls -1paF ${this.escapeRemotePath(remotePath)} 2>/dev/null"`

    const output = await this.executeCommand(listCmd)
    const lines = output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== "./" && l !== "../")

    const entries: RemoteFileEntry[] = []
    for (const line of lines) {
      const isDir = line.endsWith("/")
      const name = isDir ? line.slice(0, -1) : line
      if (!name) continue
      const entryPath = normalizeRemotePath(remotePath, name)
      entries.push({
        name,
        path: entryPath,
        isDirectory: isDir,
      })
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    return entries
  }

  async openRemoteFile(profileName: string, remotePath: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) return

    this.log(`Opening remote file: ${profileName}:${remotePath}`)

    try {
      // Download to a temp location and open
      const tmpDir = this.ctx.globalStorageUri.fsPath
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir))

      const fileName = remotePath.split("/").pop() ?? "remote-file"
      const tmpPath = vscode.Uri.joinPath(vscode.Uri.file(tmpDir), `ssh-${profileName}-${fileName}`)

      const sshBase = this.buildSSHCommandBase(profile)
      const catCmd = `${sshBase} "cat ${this.escapeRemotePath(remotePath)}"`
      const content = await this.executeCommand(catCmd)

      await vscode.workspace.fs.writeFile(tmpPath, Buffer.from(content, "utf-8"))

      const doc = await vscode.workspace.openTextDocument(tmpPath)
      await vscode.window.showTextDocument(doc)
      this.log(`Opened remote file: ${remotePath}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log(`Failed to open remote file ${remotePath}: ${errorMsg}`)
      vscode.window.showErrorMessage(`Failed to open remote file: ${errorMsg}`)
    }
  }

  async downloadFile(profileName: string, remotePath: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) return

    const fileName = remotePath.split("/").pop() ?? "downloaded-file"
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(fileName),
      title: `Download ${fileName}`,
    })
    if (!saveUri) return

    this.log(`Downloading: ${profileName}:${remotePath} -> ${saveUri.fsPath}`)

    try {
      const sshBase = this.buildSSHCommandBase(profile)
      const catCmd = `${sshBase} "cat ${this.escapeRemotePath(remotePath)}"`
      const content = await this.executeCommand(catCmd)
      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, "utf-8"))
      vscode.window.showInformationMessage(`Downloaded: ${fileName}`)
      this.log(`Downloaded: ${remotePath} -> ${saveUri.fsPath}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log(`Download failed for ${remotePath}: ${errorMsg}`)
      vscode.window.showErrorMessage(`Download failed: ${errorMsg}`)
    }
  }

  async uploadFile(profileName: string, remoteDir: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) return

    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      title: "Select file to upload",
    })
    if (!fileUris || fileUris.length === 0) return

    const localPath = fileUris[0].fsPath
    const fileName = localPath.split(/[\\/]/).pop() ?? "uploaded-file"
    const remotePath = normalizeRemotePath(remoteDir, fileName)

    this.log(`Uploading: ${localPath} -> ${profileName}:${remotePath}`)

    try {
      const sftpCmd = this.buildSFTPCommand(profile)
      // Use a batch mode sftp command
      const uploadCmd = `echo "put ${this.quoteArg(localPath)} ${this.escapeRemotePath(remotePath)}" | ${sftpCmd} -b -`
      await this.executeCommand(uploadCmd)
      vscode.window.showInformationMessage(`Uploaded: ${fileName}`)
      this.log(`Uploaded: ${localPath} -> ${remotePath}`)
      // Refresh the directory listing
      void this.listFiles(profileName, remoteDir)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log(`Upload failed: ${errorMsg}`)
      vscode.window.showErrorMessage(`Upload failed: ${errorMsg}`)
    }
  }

  // ─── Log Tailing ────────────────────────────────────────

  startLogTail(profileName: string, service?: string): void {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) {
      this.log(`Log tail failed: profile "${profileName}" not found`)
      return
    }

    // Stop existing tail for this profile
    this.stopLogTail(profileName)

    const tailCommand = this.buildLogTailCommand(profile, service)
    this.log(`Starting log tail: ${profileName} (${service || "syslog"})`)

    const terminal = vscode.window.createTerminal({
      name: `Logs: ${profile.name}${service ? ` (${service})` : ""}`,
      shellPath: this.getShellPath(),
      shellArgs: this.getShellArgs(tailCommand),
      iconPath: new vscode.ThemeIcon("output"),
    })

    const handle: LogTailHandle = {
      profileName,
      service: service ?? "",
      terminal,
      dispose: () => {
        terminal.dispose()
      },
    }

    this.logTails.set(profileName, handle)
    terminal.show()
  }

  stopLogTail(profileName: string): void {
    const handle = this.logTails.get(profileName)
    if (handle) {
      handle.dispose()
      this.logTails.delete(profileName)
      this.emit({ type: "logTailingStopped", profileName })
      this.log(`Stopped log tail: ${profileName}`)
    }
  }

  private buildLogTailCommand(profile: SSHProfile, service?: string): string {
    const sshBase = this.buildSSHCommandBase(profile)
    let remoteCommand: string

    if (!service) {
      // Default: tail syslog
      remoteCommand = "tail -f /var/log/syslog 2>/dev/null || journalctl -f 2>/dev/null || tail -f /var/log/messages"
    } else if (service.startsWith("/")) {
      // Absolute path: treat as log file
      remoteCommand = `tail -f ${this.escapeRemotePath(service)}`
    } else if (service.startsWith("docker")) {
      // Docker-specific commands pass through
      remoteCommand = `${service} 2>&1`
    } else {
      // Treat as systemd service name
      remoteCommand = `journalctl -u ${this.escapeRemotePath(service)} -f --no-pager 2>/dev/null || tail -f /var/log/${this.escapeRemotePath(service)}.log`
    }

    return `${sshBase} "${remoteCommand}"`
  }

  // ─── Shared Helpers ─────────────────────────────────────

  /**
   * Build the base ssh command for a profile (everything except the remote command).
   * Used by SFTP list, file open, download, and log commands.
   */
  private buildSSHCommandBase(profile: SSHProfile): string {
    const parts: string[] = ["ssh"]

    parts.push("-o", "StrictHostKeyChecking=accept-new")
    parts.push("-o", "BatchMode=yes")
    parts.push("-o", "ConnectTimeout=10")

    if (profile.port !== 22) {
      parts.push("-p", String(profile.port))
    }

    if (profile.authMode === "key" && profile.keyPath) {
      const resolvedPath = profile.keyPath.replace(/^~/, this.getHomePath())
      parts.push("-i", this.quoteArg(resolvedPath))
    }

    if (profile.jumpHost) {
      parts.push("-J", this.quoteArg(profile.jumpHost))
    }

    const target = profile.user ? `${profile.user}@${profile.host}` : profile.host
    parts.push(target)

    return parts.join(" ")
  }

  private escapeRemotePath(path: string): string {
    // Escape characters that are special in shell contexts
    return path.replace(/(['"\\$`! ])/g, "\\$1")
  }

  private executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const { exec } = require("child_process") as typeof import("child_process")

      exec(
        command,
        {
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          encoding: "utf-8",
        },
        (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            const msg = stderr?.trim() || error.message
            reject(new Error(msg))
            return
          }
          resolve(stdout)
        },
      )
    })
  }

  // ─── Logging ────────────────────────────────────────────

  private log(message: string): void {
    const timestamp = new Date().toISOString().slice(11, 23)
    this.outputChannel.appendLine(`[${timestamp}] ${message}`)
  }

  // ─── Disposal ───────────────────────────────────────────

  dispose(): void {
    // Stop all log tails
    this.logTails.forEach((handle) => {
      handle.dispose()
    })
    this.logTails.clear()

    // Disconnect all sessions
    Array.from(this.sessions.keys()).forEach((name) => {
      this.disconnect(name)
    })
    this.sessions.clear()

    // Clear listeners and reconnect tracking
    this.listeners.clear()
    this.reconnectAttempts.clear()

    // Dispose registered disposables
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
  }
}

// ─── Utility ────────────────────────────────────────────

function normalizeRemotePath(base: string, name: string): string {
  const cleaned = base.endsWith("/") ? base : base + "/"
  return cleaned + name
}
