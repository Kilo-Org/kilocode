import * as vscode from "vscode"
import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import { KiloLogger } from "../KiloLogger"

/**
 * EnvironmentProbeService — ultra-fast synchronous probes (<100ms total).
 *
 * Runs during extension activation before any async discovery.
 * Provides the baseline environment snapshot that drives:
 *   • Whether to run full discovery (skip if offline machine)
 *   • Which tabs to show "Loading…" vs "Empty" states
 *   • What defaults to pre-populate in wizard forms
 *
 * All operations are sync, fast, and safe to call on every activation.
 */

export interface EnvironmentSnapshot {
  timestamp: number
  platform: NodeJS.Platform
  arch: string
  nodeVersion: string
  vscodeVersion: string
  hostname: string
  username: string
  cpuCores: number
  totalMemoryGb: number
  freeMemoryGb: number
  workspaceRoot: string | undefined
  gitRepoDetected: boolean
  homeDir: string
  tempDir: string

  // File presence checks (fast existsSync, no content read)
  sshConfigExists: boolean
  sshConfigPath: string
  sshKnownHostsExists: boolean
  sshKnownHostsPath: string
  hermesConfigExists: boolean
  hermesConfigPath: string
  shibaConfigExists: boolean
  shibaConfigPath: string
  kiloDirExists: boolean
  kiloDirPath: string

  // Network assumptions (no actual probing yet — just a hint)
  hasInternetLikely: boolean  // best-effort: true if activation doesn't timeout reading env

  // User-friendly summary
  summary: {
    ready: boolean
    blockers: string[]
    warnings: string[]
  }
}

export class EnvironmentProbeService implements vscode.Disposable {
  private readonly log = KiloLogger.for("EnvironmentProbe")
  private cachedSnapshot: EnvironmentSnapshot | undefined

  constructor(private readonly context: vscode.ExtensionContext) {
    this.log.info("EnvironmentProbeService initialized")
  }

  /** Run all synchronous probes and return a snapshot. */
  probe(): EnvironmentSnapshot {
    const start = performance.now()
    const homeDir = os.homedir()
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const sshConfigPath = path.join(homeDir, ".ssh", "config")
    const sshKnownHostsPath = path.join(homeDir, ".ssh", "known_hosts")

    const kiloDirPath = workspaceRoot ? path.join(workspaceRoot, ".kilo") : path.join(homeDir, ".kilo")
    const hermesConfigPath = path.join(kiloDirPath, "hermes.json")
    const shibaConfigPath = path.join(kiloDirPath, "shiba.json")

    const snap: EnvironmentSnapshot = {
      timestamp: Date.now(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      vscodeVersion: vscode.version,
      hostname: os.hostname(),
      username: os.userInfo().username,
      cpuCores: os.cpus().length,
      totalMemoryGb: Math.round(os.totalmem() / (1024 ** 3)),
      freeMemoryGb: Math.round(os.freemem() / (1024 ** 3)),
      workspaceRoot,
      gitRepoDetected: this.detectGitRepo(workspaceRoot),
      homeDir,
      tempDir: os.tmpdir(),
      sshConfigExists: this.fileExists(sshConfigPath),
      sshConfigPath,
      sshKnownHostsExists: this.fileExists(sshKnownHostsPath),
      sshKnownHostsPath,
      hermesConfigExists: this.fileExists(hermesConfigPath),
      hermesConfigPath,
      shibaConfigExists: this.fileExists(shibaConfigPath),
      shibaConfigPath,
      kiloDirExists: this.fileExists(kiloDirPath),
      kiloDirPath,
      hasInternetLikely: true,  // Assume yes; real probe happens later
      summary: { ready: true, blockers: [], warnings: [] },
    }

    // Generate summary
    if (snap.totalMemoryGb < 4) {
      snap.summary.warnings.push(`Low RAM detected: ${snap.totalMemoryGb}GB`)
    }
    if (snap.cpuCores < 2) {
      snap.summary.warnings.push(`Only ${snap.cpuCores} CPU core(s) detected`)
    }
    if (!snap.workspaceRoot) {
      snap.summary.warnings.push("No workspace folder — some features will be limited")
    }
    if (snap.freeMemoryGb < 1) {
      snap.summary.blockers.push(`Very low free RAM: ${snap.freeMemoryGb}GB`)
      snap.summary.ready = false
    }

    this.cachedSnapshot = snap
    const elapsed = performance.now() - start
    this.log.info("Environment probe complete", {
      elapsedMs: Math.round(elapsed),
      platform: snap.platform,
      arch: snap.arch,
      cpuCores: snap.cpuCores,
      ramGb: snap.totalMemoryGb,
      sshConfig: snap.sshConfigExists,
      hermes: snap.hermesConfigExists,
      workspace: snap.workspaceRoot ? "yes" : "no",
    })
    return snap
  }

  /** Get the last cached snapshot without re-running probes. */
  getCachedSnapshot(): EnvironmentSnapshot | undefined {
    return this.cachedSnapshot
  }

  /** Re-run probes and return fresh snapshot. */
  refresh(): EnvironmentSnapshot {
    return this.probe()
  }

  /** Generate a human-readable string for display. */
  formatSummary(snap?: EnvironmentSnapshot): string {
    const s = snap ?? this.cachedSnapshot
    if (!s) return "Environment not probed yet"
    const parts: string[] = []
    parts.push(`${s.platform}/${s.arch}`)
    parts.push(`${s.cpuCores} cores`)
    parts.push(`${s.totalMemoryGb}GB RAM (${s.freeMemoryGb}GB free)`)
    if (s.workspaceRoot) parts.push(`workspace: ${path.basename(s.workspaceRoot)}`)
    if (s.sshConfigExists) parts.push("ssh config ✓")
    if (s.hermesConfigExists) parts.push("hermes ✓")
    if (s.shibaConfigExists) parts.push("shiba ✓")
    return parts.join(" | ")
  }

  // ─── Helpers ──────────────────────────────────────────

  private fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath)
    } catch {
      return false
    }
  }

  private detectGitRepo(workspaceRoot: string | undefined): boolean {
    if (!workspaceRoot) return false
    try {
      return fs.existsSync(path.join(workspaceRoot, ".git"))
    } catch {
      return false
    }
  }

  dispose(): void {
    // No resources to clean up
  }
}
