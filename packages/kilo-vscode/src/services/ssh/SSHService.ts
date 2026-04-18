import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { KiloLogger } from "../KiloLogger"

// ─── Types ──────────────────────────────────────────────

export type AuthMode = "key" | "password"
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

export type SSHErrorCode =
  | "CONNECTION_REFUSED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "HOST_KEY_MISMATCH"
  | "SFTP_ERROR"
  | "UNKNOWN"

export class SSHError extends Error {
  readonly code: SSHErrorCode
  readonly profileName: string
  readonly timestamp: number

  constructor(message: string, code: SSHErrorCode, profileName: string) {
    super(message)
    this.name = "SSHError"
    this.code = code
    this.profileName = profileName
    this.timestamp = Date.now()
  }
}

/** Metadata for a remote file opened locally for editing. */
export interface TrackedRemoteFile {
  localPath: string
  remotePath: string
  profileId: string
}

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
  | { type: "filePreview"; profileName: string; remotePath: string; content: string }
  | { type: "logOutput"; profileName: string; lines: { timestamp: string; text: string }[] }
  | { type: "logTailingStopped"; profileName: string }
  | { type: "sshError"; error: { message: string; code: SSHErrorCode; profileName: string; timestamp: number } }

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

  // Phase 22: SFTP browser model — current browse path per session
  private readonly currentBrowsePaths = new Map<string, string>()

  // Phase 23: Remote edit/save — tracked temp files keyed by local temp path
  private readonly trackedRemoteFiles = new Map<string, TrackedRemoteFile>()

  // Phase 26: Error tracking
  private readonly errorLog: SSHError[] = []
  private static readonly MAX_ERROR_LOG = 50
  private readonly errorListeners = new Set<(error: SSHError) => void>()
  private readonly kiloLog = KiloLogger.for("SSHService")

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel("KiloCode SSH")
    this.disposables.push(this.outputChannel)
    this.kiloLog.info("SSHService initialized")

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

    // Phase 23: Watch for saves on tracked remote temp files
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      const normalizedPath = doc.uri.fsPath.replace(/\\/g, "/")
      const tracked = this.trackedRemoteFiles.get(normalizedPath)
      if (tracked) {
        this.log(`Detected save on tracked remote file: ${tracked.remotePath}`)
        void this.saveRemoteFile(tracked.profileId, normalizedPath, tracked.remotePath)
      }
    })
    this.disposables.push(saveWatcher)

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

  // ─── Error Handling (Phase 26) ──────────────────────────

  /** Subscribe to SSH errors. Returns an unsubscribe function. */
  onError(listener: (error: SSHError) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  /** Returns recent errors, optionally filtered by profileName. */
  getLastErrors(profileId?: string): SSHError[] {
    if (profileId) {
      return this.errorLog.filter((e) => e.profileName === profileId)
    }
    return [...this.errorLog]
  }

  /** Classify a raw error message into an SSHErrorCode. */
  private classifyError(message: string): SSHErrorCode {
    const lower = message.toLowerCase()
    if (lower.includes("connection refused") || lower.includes("no route to host")) return "CONNECTION_REFUSED"
    if (lower.includes("permission denied") || lower.includes("authentication failed") || lower.includes("auth fail")) return "AUTH_FAILED"
    if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("connection timed out")) return "TIMEOUT"
    if (lower.includes("host key") || lower.includes("man-in-the-middle") || lower.includes("offending key")) return "HOST_KEY_MISMATCH"
    if (lower.includes("sftp") || lower.includes("no such file") || lower.includes("failure")) return "SFTP_ERROR"
    return "UNKNOWN"
  }

  /** Record an SSH error and notify listeners. */
  private recordError(message: string, profileName: string, code?: SSHErrorCode): SSHError {
    const resolvedCode = code ?? this.classifyError(message)
    const error = new SSHError(message, resolvedCode, profileName)

    this.errorLog.push(error)
    if (this.errorLog.length > SSHService.MAX_ERROR_LOG) {
      this.errorLog.splice(0, this.errorLog.length - SSHService.MAX_ERROR_LOG)
    }

    this.errorListeners.forEach((listener) => {
      try {
        listener(error)
      } catch (err) {
        this.log(`Error listener threw: ${err}`)
      }
    })

    this.emit({
      type: "sshError",
      error: { message: error.message, code: error.code, profileName: error.profileName, timestamp: error.timestamp },
    })

    return error
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

  /**
   * Parse ~/.ssh/config and import host entries as SSHProfile objects.
   * Read-only: no connections are made. Skips wildcard hosts and hosts
   * that already exist (matched by name). Returns the newly imported profiles.
   */
  async importFromSSHConfig(): Promise<SSHProfile[]> {
    const configPath = path.join(os.homedir(), ".ssh", "config")

    if (!fs.existsSync(configPath)) {
      this.log(`SSH config not found at ${configPath}`)
      return []
    }

    let content: string
    try {
      content = fs.readFileSync(configPath, "utf-8")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.log(`Failed to read SSH config: ${msg}`)
      return []
    }

    const existingProfiles = this.getProfiles()
    const existingNames = new Set(existingProfiles.map((p) => p.name))

    const imported: SSHProfile[] = []
    const lines = content.split(/\r?\n/)

    let current: Partial<SSHProfile> | null = null
    let currentNames: string[] = []

    const flushCurrent = () => {
      if (!current || currentNames.length === 0) return
      for (const hostAlias of currentNames) {
        if (existingNames.has(hostAlias)) {
          this.log(`Skipping SSH config host "${hostAlias}" (already exists)`)
          continue
        }
        const profile: SSHProfile = {
          name: hostAlias,
          host: (current.host as string) || hostAlias,
          port: current.port ?? 22,
          user: current.user ?? "",
          authMode: current.keyPath ? "key" : "password",
          keyPath: current.keyPath,
          jumpHost: current.jumpHost,
          group: "imported",
          labels: ["ssh-config"],
        }
        imported.push(profile)
        existingNames.add(hostAlias)
      }
    }

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (line === "" || line.startsWith("#")) continue

      const hostMatch = line.match(/^Host\s+(.+)$/i)
      if (hostMatch) {
        // Flush the previous block
        flushCurrent()

        // Start a new block — split on whitespace for multiple host aliases
        const aliases = hostMatch[1].split(/\s+/).filter((h) => h.length > 0)
        // Skip any alias that is a wildcard pattern
        const validAliases = aliases.filter((h) => !h.includes("*") && !h.includes("?"))
        if (validAliases.length === 0) {
          current = null
          currentNames = []
        } else {
          current = {}
          currentNames = validAliases
        }
        continue
      }

      if (!current) continue

      const kvMatch = line.match(/^(\S+)\s+(.+)$/)
      if (!kvMatch) continue

      const key = kvMatch[1].toLowerCase()
      const value = kvMatch[2].trim()

      switch (key) {
        case "hostname":
          current.host = value
          break
        case "port":
          current.port = parseInt(value, 10) || 22
          break
        case "user":
          current.user = value
          break
        case "identityfile":
          current.keyPath = value
          break
        case "proxyjump":
          current.jumpHost = value
          break
      }
    }

    // Flush the last block
    flushCurrent()

    if (imported.length > 0) {
      const allProfiles = [...existingProfiles, ...imported]
      await this.writeProfiles(allProfiles)
      this.log(`Imported ${imported.length} profile(s) from SSH config`)
    } else {
      this.log("No new profiles to import from SSH config")
    }

    return imported
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
      this.recordError(errorMsg, profileName)
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
      this.currentBrowsePaths.set(profileName, normalizedPath)
      this.emit({
        type: "filesListed",
        profileName,
        path: normalizedPath,
        entries,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.recordError(errorMsg, profileName, "SFTP_ERROR")
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

  // ─── Phase 22: SFTP Browser Model ──────────────────────

  /**
   * Browse a remote directory, returning its entries.
   * Wraps listRemoteFiles with error handling and breadcrumb tracking.
   */
  async browseDirectory(profileId: string, browsePath: string): Promise<RemoteFileEntry[]> {
    const profile = this.getProfiles().find((p) => p.name === profileId)
    if (!profile) {
      this.recordError(`Profile "${profileId}" not found`, profileId, "SFTP_ERROR")
      return []
    }

    const normalizedPath = browsePath || "/"
    try {
      const entries = await this.executeSFTPList(profile, normalizedPath)
      this.currentBrowsePaths.set(profileId, normalizedPath)
      this.emit({
        type: "filesListed",
        profileName: profileId,
        path: normalizedPath,
        entries,
      })
      return entries
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.recordError(errorMsg, profileId, "SFTP_ERROR")
      this.log(`browseDirectory error for ${profileId}:${normalizedPath}: ${errorMsg}`)
      return []
    }
  }

  /** Get the current browse path for a profile. */
  getCurrentBrowsePath(profileId: string): string {
    return this.currentBrowsePaths.get(profileId) ?? "/"
  }

  /**
   * Preview a small text file from a remote host (< 100 KB).
   * Returns the file content as a string, or empty string on failure.
   */
  async getFilePreview(profileId: string, remotePath: string): Promise<string> {
    const profile = this.getProfiles().find((p) => p.name === profileId)
    if (!profile) {
      this.recordError(`Profile "${profileId}" not found`, profileId, "SFTP_ERROR")
      return ""
    }

    this.log(`File preview: ${profileId}:${remotePath}`)

    try {
      const sshBase = this.buildSSHCommandBase(profile)
      // Check file size first; bail if > 100KB
      const sizeCmd = `${sshBase} "stat -c%s ${this.escapeRemotePath(remotePath)} 2>/dev/null || stat -f%z ${this.escapeRemotePath(remotePath)} 2>/dev/null"`
      const sizeOut = await this.executeCommand(sizeCmd)
      const fileSize = parseInt(sizeOut.trim(), 10)
      if (!isNaN(fileSize) && fileSize > 100 * 1024) {
        this.log(`File preview skipped (${fileSize} bytes > 100KB): ${remotePath}`)
        return `[File too large for preview: ${Math.round(fileSize / 1024)} KB]`
      }

      // Read the file content
      const catCmd = `${sshBase} "cat ${this.escapeRemotePath(remotePath)}"`
      const content = await this.executeCommand(catCmd)

      this.emit({
        type: "filePreview",
        profileName: profileId,
        remotePath,
        content,
      })

      return content
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.recordError(errorMsg, profileId, "SFTP_ERROR")
      this.log(`File preview error for ${profileId}:${remotePath}: ${errorMsg}`)
      return ""
    }
  }

  // ─── Phase 23: Remote Edit / Save Flow ─────────────────

  /**
   * Download a remote file to a temp directory and open it in VS Code.
   * Tracked so that saves auto-upload back to the remote host.
   */
  async openRemoteFile(profileName: string, remotePath: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) {
      this.recordError(`Profile "${profileName}" not found`, profileName, "SFTP_ERROR")
      return
    }

    this.log(`Opening remote file: ${profileName}:${remotePath}`)

    try {
      // Create a temp directory scoped to this extension
      const tmpDir = path.join(os.tmpdir(), "kilocode-ssh", profileName)
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir))

      const fileName = remotePath.split("/").pop() ?? "remote-file"
      // Use a deterministic name so re-opening the same file reuses the same temp path
      const safeName = remotePath.replace(/\//g, "__").replace(/[^a-zA-Z0-9._\-]/g, "_")
      const localTmpPath = path.join(tmpDir, safeName)

      const sshBase = this.buildSSHCommandBase(profile)
      const catCmd = `${sshBase} "cat ${this.escapeRemotePath(remotePath)}"`
      const content = await this.executeCommand(catCmd)

      const tmpUri = vscode.Uri.file(localTmpPath)
      await vscode.workspace.fs.writeFile(tmpUri, Buffer.from(content, "utf-8"))

      // Track this file for auto-save-back
      const normalizedLocal = localTmpPath.replace(/\\/g, "/")
      this.trackedRemoteFiles.set(normalizedLocal, {
        localPath: normalizedLocal,
        remotePath,
        profileId: profileName,
      })

      const doc = await vscode.workspace.openTextDocument(tmpUri)
      await vscode.window.showTextDocument(doc)
      this.log(`Opened remote file (tracked): ${remotePath} -> ${localTmpPath}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.recordError(errorMsg, profileName, "SFTP_ERROR")
      this.log(`Failed to open remote file ${remotePath}: ${errorMsg}`)
      vscode.window.showErrorMessage(`Failed to open remote file: ${errorMsg}`)
    }
  }

  /**
   * Upload a local temp file back to the remote host.
   * Called automatically when a tracked temp file is saved, or manually.
   * @param confirmAndUpload If true, shows a diff before uploading (Phase 24).
   */
  async saveRemoteFile(
    profileId: string,
    localTempPath: string,
    remotePath: string,
    confirmAndUpload: boolean = false,
  ): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileId)
    if (!profile) {
      this.recordError(`Profile "${profileId}" not found`, profileId, "SFTP_ERROR")
      return
    }

    if (confirmAndUpload) {
      // Phase 24: show diff before uploading
      await this.diffRemoteFile(profileId, localTempPath, remotePath)
      return
    }

    this.log(`Saving remote file: ${localTempPath} -> ${profileId}:${remotePath}`)

    try {
      const sftpCmd = this.buildSFTPCommand(profile)
      const normalizedLocal = localTempPath.replace(/\\/g, "/")
      const uploadCmd = `echo "put ${this.quoteArg(normalizedLocal)} ${this.escapeRemotePath(remotePath)}" | ${sftpCmd} -b -`
      await this.executeCommand(uploadCmd)
      vscode.window.showInformationMessage(`Saved remote file: ${remotePath}`)
      this.log(`Saved remote file: ${remotePath}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.recordError(errorMsg, profileId, "SFTP_ERROR")
      this.log(`Failed to save remote file ${remotePath}: ${errorMsg}`)
      vscode.window.showErrorMessage(`Failed to save remote file: ${errorMsg}`)
    }
  }

  /** Return a snapshot of all currently tracked remote files. */
  getTrackedRemoteFiles(): TrackedRemoteFile[] {
    return Array.from(this.trackedRemoteFiles.values())
  }

  // ─── Phase 24: Diff Before Save ────────────────────────

  /**
   * Open a VS Code diff editor comparing the local version with the current remote version.
   * After reviewing, the user can manually trigger the upload.
   */
  async diffRemoteFile(profileId: string, localPath: string, remotePath: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileId)
    if (!profile) {
      this.recordError(`Profile "${profileId}" not found`, profileId, "SFTP_ERROR")
      return
    }

    this.log(`Diff remote file: ${profileId}:${remotePath} vs ${localPath}`)

    try {
      // Download current remote version to a second temp file
      const tmpDir = path.join(os.tmpdir(), "kilocode-ssh", profileId, ".diff")
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir))

      const fileName = remotePath.split("/").pop() ?? "remote-file"
      const remoteTmpPath = path.join(tmpDir, `remote-${fileName}`)

      const sshBase = this.buildSSHCommandBase(profile)
      const catCmd = `${sshBase} "cat ${this.escapeRemotePath(remotePath)}"`
      const remoteContent = await this.executeCommand(catCmd)

      const remoteTmpUri = vscode.Uri.file(remoteTmpPath)
      await vscode.workspace.fs.writeFile(remoteTmpUri, Buffer.from(remoteContent, "utf-8"))

      const localUri = vscode.Uri.file(localPath)
      const title = `${fileName} (Remote) \u2194 ${fileName} (Local Edit)`

      await vscode.commands.executeCommand("vscode.diff", remoteTmpUri, localUri, title)
      this.log(`Opened diff view for: ${remotePath}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.recordError(errorMsg, profileId, "SFTP_ERROR")
      this.log(`Failed to diff remote file ${remotePath}: ${errorMsg}`)
      vscode.window.showErrorMessage(`Failed to open diff: ${errorMsg}`)
    }
  }

  // ─── SFTP Download / Upload ─────────────────────────────

  async downloadFile(profileName: string, remotePath: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) {
      this.recordError(`Profile "${profileName}" not found`, profileName, "SFTP_ERROR")
      return
    }

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
      this.recordError(errorMsg, profileName, "SFTP_ERROR")
      this.log(`Download failed for ${remotePath}: ${errorMsg}`)
      vscode.window.showErrorMessage(`Download failed: ${errorMsg}`)
    }
  }

  async uploadFile(profileName: string, remoteDir: string): Promise<void> {
    const profile = this.getProfiles().find((p) => p.name === profileName)
    if (!profile) {
      this.recordError(`Profile "${profileName}" not found`, profileName, "SFTP_ERROR")
      return
    }

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
      this.recordError(errorMsg, profileName, "SFTP_ERROR")
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
    // Also forward to centralized KiloLogger for unified V4 output
    this.kiloLog.info(message)
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

    // Phase 22/23/26 cleanup
    this.currentBrowsePaths.clear()
    this.trackedRemoteFiles.clear()
    this.errorLog.length = 0
    this.errorListeners.clear()

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
