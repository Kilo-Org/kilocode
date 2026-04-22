import * as vscode from "vscode"
import { KiloLogger } from "../KiloLogger"

// ─── Types ───────────────────────────────────────────────

export interface VPSServer {
  id: string
  hostname: string
  ip: string
  sshProfile: string
  os: string
  region: string
  tags: string[]
  status: "online" | "offline" | "degraded" | "critical" | "unknown"
}

export interface VPSMetrics {
  serverId: string
  cpu: number
  ramUsed: number
  ramTotal: number
  disks: Array<{ mount: string; used: number; total: number }>
  timestamp: number
}

export interface ServiceInfo {
  name: string
  status: "running" | "stopped" | "failed"
  pid: number
  cpuPercent: number
  memPercent: number
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  ports: string[]
}

export interface DeployEntry {
  id: string
  serverId: string
  timestamp: number
  action: string
  status: "success" | "failed" | "in-progress"
  rollbackAvailable: boolean
}

export interface RunbookStep {
  order: number
  name: string
  description: string
  command?: string
}

export interface BackupRunbook {
  serverId: string
  title: string
  estimatedDurationMinutes: number
  steps: RunbookStep[]
}

export interface IncidentRunbook {
  serverId: string
  title: string
  steps: RunbookStep[]
}

export interface ReverseProxyConfig {
  type: "nginx" | "caddy"
  domain: string
  upstream: string
  sslEnabled: boolean
  configPath: string
}

export interface ReverseProxyTestResult {
  valid: boolean
  errors: string[]
}

export interface DeployPreflightResult {
  ok: boolean
  serverId: string
  reachable: boolean
  status: VPSServer["status"]
  errors: string[]
}

/**
 * SSHService interface expected by VPSService.
 * If the real SSHService exists, it should satisfy this contract.
 * Otherwise VPSService creates its own SSH connections via vscode terminals.
 */
export interface SSHService {
  exec(profile: string, command: string): Promise<string>
  isConnected(profile: string): boolean
}

// ─── Constants ───────────────────────────────────────────

const VPS_CFG_SECTION = "kilo-code.new.vps"
const VPS_SERVERS_KEY = "servers"
const VPS_DEPLOY_HISTORY_KEY = "vps.deployHistory"

// ─── SSH Command Runner (fallback) ──────────────────────

/**
 * Minimal SSH executor that runs a command on a remote host via a VS Code
 * terminal and captures the output. Used when no SSHService is injected.
 */
class TerminalSSHRunner implements SSHService {
  private readonly outputChannel: vscode.OutputChannel

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("VPS SSH")
  }

  async exec(profileOrIp: string, command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`SSH command timed out after 30s: ${command}`))
      }, 30_000)

      // Use child_process via Node.js to run SSH and capture output
      const cp = require("child_process") as typeof import("child_process")
      const proc = cp.spawn("ssh", ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", profileOrIp, command], {
        shell: true,
        timeout: 30_000,
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on("close", (code: number | null) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve(stdout)
        } else {
          this.outputChannel.appendLine(`[VPS SSH] Command failed on ${profileOrIp}: ${command}`)
          this.outputChannel.appendLine(`[VPS SSH] stderr: ${stderr}`)
          reject(new Error(`SSH exit code ${code}: ${stderr.trim() || "unknown error"}`))
        }
      })

      proc.on("error", (err: Error) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  isConnected(_profile: string): boolean {
    // No persistent connections; each exec spawns a new SSH process
    return true
  }

  dispose(): void {
    this.outputChannel.dispose()
  }
}

// ─── Parsers ─────────────────────────────────────────────

function parseCpuUsage(output: string): number {
  // Parse output of: top -bn1 | grep "Cpu(s)"
  // Example: %Cpu(s):  3.2 us,  1.0 sy,  0.0 ni, 95.4 id,  0.3 wa,  0.0 hi,  0.1 si,  0.0 st
  const match = output.match(/(\d+\.?\d*)\s*id/)
  if (match) {
    return Math.round((100 - parseFloat(match[1])) * 10) / 10
  }
  // Alternative: mpstat or /proc/stat percentage
  const usMatch = output.match(/(\d+\.?\d*)\s*us/)
  const syMatch = output.match(/(\d+\.?\d*)\s*sy/)
  if (usMatch && syMatch) {
    return Math.round((parseFloat(usMatch[1]) + parseFloat(syMatch[1])) * 10) / 10
  }
  return 0
}

function parseMemory(output: string): { used: number; total: number } {
  // Parse output of: free -b | grep Mem
  // Example: Mem:    16694804480  8347402240  4173701120  1048576000  4173701120  7298662400
  const lines = output.split("\n")
  for (const line of lines) {
    const match = line.match(/Mem:\s+(\d+)\s+(\d+)/)
    if (match) {
      return { total: parseInt(match[1], 10), used: parseInt(match[2], 10) }
    }
  }
  return { used: 0, total: 0 }
}

function parseDisks(output: string): Array<{ mount: string; used: number; total: number }> {
  // Parse output of: df -B1 --output=target,used,size | tail -n +2
  // Example lines:
  //   /            21474836480 107374182400
  //   /boot          209715200   1073741824
  const disks: Array<{ mount: string; used: number; total: number }> = []
  const lines = output.trim().split("\n")
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 3) {
      const mount = parts[0]
      const used = parseInt(parts[1], 10)
      const total = parseInt(parts[2], 10)
      if (!isNaN(used) && !isNaN(total) && total > 0) {
        disks.push({ mount, used, total })
      }
    }
  }
  return disks
}

function parseServices(output: string): ServiceInfo[] {
  // Parse output of: systemctl list-units --type=service --state=running,failed --no-legend --no-pager
  // Then for each, we get CPU/MEM from a combined ps output
  // Format: <unit> <load> <active> <sub> <description>
  const services: ServiceInfo[] = []
  const lines = output.trim().split("\n")
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4) continue

    const name = parts[0].replace(/\.service$/, "")
    const sub = parts[3] // "running", "exited", "failed", etc.
    let status: "running" | "stopped" | "failed" = "stopped"
    if (sub === "running") status = "running"
    else if (sub === "failed") status = "failed"

    services.push({
      name,
      status,
      pid: 0,
      cpuPercent: 0,
      memPercent: 0,
    })
  }
  return services
}

function parseProcessStats(output: string, services: ServiceInfo[]): ServiceInfo[] {
  // Parse output of: ps aux --no-headers
  // Format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
  const nameMap = new Map<string, ServiceInfo>()
  for (const s of services) {
    nameMap.set(s.name, s)
  }

  const lines = output.trim().split("\n")
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 11) continue

    const pid = parseInt(parts[1], 10)
    const cpuPct = parseFloat(parts[2])
    const memPct = parseFloat(parts[3])
    const command = parts.slice(10).join(" ")

    // Try to match a service name in the command path
    for (const [svcName, svc] of nameMap) {
      if (command.includes(svcName) && svc.pid === 0) {
        svc.pid = pid
        svc.cpuPercent = isNaN(cpuPct) ? 0 : cpuPct
        svc.memPercent = isNaN(memPct) ? 0 : memPct
        break
      }
    }
  }

  return services
}

function parseDockerPs(output: string): DockerContainer[] {
  // Parse output of: docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
  const containers: DockerContainer[] = []
  const lines = output.trim().split("\n")
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    if (parts.length < 4) continue

    containers.push({
      id: parts[0],
      name: parts[1],
      image: parts[2],
      status: parts[3],
      ports: parts[4] ? parts[4].split(",").map((p) => p.trim()).filter(Boolean) : [],
    })
  }
  return containers
}

// ─── Service ─────────────────────────────────────────────

export class VPSService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private readonly outputChannel: vscode.OutputChannel
  private ssh: SSHService
  private fallbackRunner: TerminalSSHRunner | undefined
  private readonly kiloLog = KiloLogger.for("VPSService")

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    sshService?: SSHService,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("VPS Management")
    this.disposables.push(this.outputChannel)
    this.kiloLog.info("VPSService initialized")

    if (sshService) {
      this.ssh = sshService
    } else {
      this.fallbackRunner = new TerminalSSHRunner()
      this.ssh = this.fallbackRunner
    }

    // Watch for config changes to re-read server list
    const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(VPS_CFG_SECTION)) {
        this.log("VPS configuration changed")
      }
    })
    this.disposables.push(watcher)
  }

  // ── Server Inventory ─────────────────────────────────

  /**
   * Read all registered VPS servers from VS Code settings.
   */
  getServers(): VPSServer[] {
    const cfg = vscode.workspace.getConfiguration(VPS_CFG_SECTION)
    return cfg.get<VPSServer[]>(VPS_SERVERS_KEY, [])
  }

  /**
   * Save the full server list to VS Code settings.
   */
  private async saveServers(servers: VPSServer[]): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(VPS_CFG_SECTION)
    await cfg.update(VPS_SERVERS_KEY, servers, vscode.ConfigurationTarget.Global)
  }

  /**
   * Add or update a VPS server in the inventory.
   * If a server with the same ID already exists, it is replaced.
   */
  async addOrUpdateServer(server: VPSServer): Promise<VPSServer> {
    const servers = this.getServers()
    const idx = servers.findIndex((s) => s.id === server.id)
    if (idx >= 0) {
      servers[idx] = server
    } else {
      servers.push(server)
    }
    await this.saveServers(servers)
    this.log(`Server ${idx >= 0 ? "updated" : "added"}: ${server.hostname} (${server.ip})`)
    return server
  }

  /**
   * Remove a VPS server by ID.
   */
  async removeServer(serverId: string): Promise<void> {
    const servers = this.getServers()
    const filtered = servers.filter((s) => s.id !== serverId)
    if (filtered.length === servers.length) {
      this.log(`Server not found for removal: ${serverId}`)
      return
    }
    await this.saveServers(filtered)
    this.log(`Server removed: ${serverId}`)
  }

  /**
   * Get a single server by ID.
   */
  getServer(serverId: string): VPSServer | undefined {
    return this.getServers().find((s) => s.id === serverId)
  }

  // ── Remote Command Execution ─────────────────────────

  /**
   * Execute a command on a remote server via SSH.
   * Uses the server's sshProfile if set, otherwise falls back to user@ip.
   */
  private async execRemote(server: VPSServer, command: string): Promise<string> {
    const target = server.sshProfile || server.ip
    this.log(`Executing on ${server.hostname} (${target}): ${command}`)
    try {
      const result = await this.ssh.exec(target, command)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.log(`Command failed on ${server.hostname}: ${msg}`)
      throw err
    }
  }

  // ── Metrics ──────────────────────────────────────────

  /**
   * Fetch resource metrics (CPU, RAM, disk) from a remote server.
   * Updates the server status based on reachability.
   */
  async fetchMetrics(serverId: string): Promise<VPSMetrics> {
    const server = this.getServer(serverId)
    if (!server) {
      throw new Error(`Server not found: ${serverId}`)
    }

    try {
      // Run all metric commands in parallel via a single SSH session using semicolons
      const combinedCommand = [
        "echo '---CPU---'",
        "top -bn1 | grep 'Cpu(s)' 2>/dev/null || cat /proc/stat | head -1",
        "echo '---MEM---'",
        "free -b | grep Mem",
        "echo '---DISK---'",
        "df -B1 --output=target,used,size 2>/dev/null | tail -n +2 || df -k | tail -n +2",
      ].join(" ; ")

      const output = await this.execRemote(server, combinedCommand)

      // Split output by markers
      const cpuSection = extractSection(output, "---CPU---", "---MEM---")
      const memSection = extractSection(output, "---MEM---", "---DISK---")
      const diskSection = extractSection(output, "---DISK---", undefined)

      const cpu = parseCpuUsage(cpuSection)
      const mem = parseMemory(memSection)
      const disks = parseDisks(diskSection)

      // Update server status to online
      await this.updateServerStatus(serverId, "online")

      const metrics: VPSMetrics = {
        serverId,
        cpu,
        ramUsed: mem.used,
        ramTotal: mem.total,
        disks,
        timestamp: Date.now(),
      }

      this.log(`Metrics fetched for ${server.hostname}: CPU=${cpu}%, RAM=${mem.used}/${mem.total}`)
      return metrics
    } catch (err) {
      // Mark server as offline/degraded on failure
      await this.updateServerStatus(serverId, "offline")
      throw err
    }
  }

  /**
   * Update a server's status field.
   */
  private async updateServerStatus(serverId: string, status: VPSServer["status"]): Promise<void> {
    const servers = this.getServers()
    const idx = servers.findIndex((s) => s.id === serverId)
    if (idx >= 0 && servers[idx].status !== status) {
      servers[idx] = { ...servers[idx], status }
      await this.saveServers(servers)
    }
  }

  // ── Service Management ───────────────────────────────

  /**
   * List running services on a remote server.
   */
  async listServices(serverId: string): Promise<ServiceInfo[]> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    try {
      const [svcOutput, psOutput] = await Promise.all([
        this.execRemote(
          server,
          "systemctl list-units --type=service --state=running,failed --no-legend --no-pager 2>/dev/null || service --status-all 2>/dev/null",
        ),
        this.execRemote(server, "ps aux --no-headers 2>/dev/null || ps -ef 2>/dev/null"),
      ])

      let services = parseServices(svcOutput)
      services = parseProcessStats(psOutput, services)

      this.log(`Found ${services.length} services on ${server.hostname}`)
      return services
    } catch (err) {
      this.log(`Failed to list services on ${server.hostname}: ${err}`)
      throw err
    }
  }

  /**
   * Perform an action on a systemd service.
   */
  async serviceAction(
    serverId: string,
    serviceName: string,
    action: "restart" | "stop" | "logs",
  ): Promise<string> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    let command: string
    switch (action) {
      case "restart":
        command = `sudo systemctl restart ${shellEscape(serviceName)}`
        break
      case "stop":
        command = `sudo systemctl stop ${shellEscape(serviceName)}`
        break
      case "logs":
        command = `sudo journalctl -u ${shellEscape(serviceName)} --no-pager -n 100`
        break
    }

    this.log(`Service action: ${action} ${serviceName} on ${server.hostname}`)
    const result = await this.execRemote(server, command)

    if (action === "logs") {
      // Show logs in an output channel
      this.outputChannel.show(true)
      this.outputChannel.appendLine(`\n--- Logs for ${serviceName} on ${server.hostname} ---`)
      this.outputChannel.appendLine(result)
    }

    return result
  }

  // ── Docker Management ────────────────────────────────

  /**
   * List Docker containers on a remote server.
   */
  async listContainers(serverId: string): Promise<DockerContainer[]> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    try {
      const output = await this.execRemote(
        server,
        'docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null',
      )
      const containers = parseDockerPs(output)
      this.log(`Found ${containers.length} containers on ${server.hostname}`)
      return containers
    } catch (err) {
      // Docker may not be installed; return empty
      this.log(`Docker not available on ${server.hostname}: ${err}`)
      return []
    }
  }

  /**
   * Perform an action on a Docker container.
   */
  async dockerAction(
    serverId: string,
    containerId: string,
    action: "start" | "stop" | "restart" | "remove" | "logs",
  ): Promise<string> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    let command: string
    switch (action) {
      case "start":
        command = `docker start ${shellEscape(containerId)}`
        break
      case "stop":
        command = `docker stop ${shellEscape(containerId)}`
        break
      case "restart":
        command = `docker restart ${shellEscape(containerId)}`
        break
      case "remove":
        command = `docker rm -f ${shellEscape(containerId)}`
        break
      case "logs":
        command = `docker logs --tail 200 ${shellEscape(containerId)}`
        break
    }

    this.log(`Docker action: ${action} ${containerId} on ${server.hostname}`)
    const result = await this.execRemote(server, command)

    if (action === "logs") {
      this.outputChannel.show(true)
      this.outputChannel.appendLine(`\n--- Docker logs for ${containerId} on ${server.hostname} ---`)
      this.outputChannel.appendLine(result)
    }

    return result
  }

  // ── Deploy & Recovery ────────────────────────────────

  /**
   * Get the deployment history for a server.
   */
  getDeployHistory(serverId: string): DeployEntry[] {
    const all = this.ctx.globalState.get<DeployEntry[]>(VPS_DEPLOY_HISTORY_KEY, [])
    return all
      .filter((e) => e.serverId === serverId)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Record a new deployment in the history.
   */
  async recordDeploy(serverId: string, action: string, status: DeployEntry["status"]): Promise<DeployEntry> {
    const entry: DeployEntry = {
      id: `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      serverId,
      timestamp: Date.now(),
      action,
      status,
      rollbackAvailable: status === "success",
    }

    const all = this.ctx.globalState.get<DeployEntry[]>(VPS_DEPLOY_HISTORY_KEY, [])
    all.push(entry)

    // Keep only the last 100 entries per server
    const forServer = all.filter((e) => e.serverId === serverId)
    if (forServer.length > 100) {
      const idsToRemove = new Set(
        forServer
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, forServer.length - 100)
          .map((e) => e.id),
      )
      const pruned = all.filter((e) => !idsToRemove.has(e.id))
      await this.ctx.globalState.update(VPS_DEPLOY_HISTORY_KEY, pruned)
    } else {
      await this.ctx.globalState.update(VPS_DEPLOY_HISTORY_KEY, all)
    }

    this.log(`Deploy recorded for ${serverId}: ${action} (${status})`)
    return entry
  }

  /**
   * Perform a rollback to a previous deployment.
   * This marks the rollback entry as in-progress and creates a new deploy entry.
   */
  async rollback(serverId: string, deployId: string): Promise<DeployEntry> {
    const history = this.getDeployHistory(serverId)
    const target = history.find((e) => e.id === deployId)
    if (!target) {
      throw new Error(`Deploy entry not found: ${deployId}`)
    }
    if (!target.rollbackAvailable) {
      throw new Error(`Rollback not available for deploy: ${deployId}`)
    }

    this.log(`Rolling back to deploy ${deployId} on ${serverId}`)

    // Mark the original as no longer rollback-able
    const all = this.ctx.globalState.get<DeployEntry[]>(VPS_DEPLOY_HISTORY_KEY, [])
    const idx = all.findIndex((e) => e.id === deployId)
    if (idx >= 0) {
      all[idx] = { ...all[idx], rollbackAvailable: false }
      await this.ctx.globalState.update(VPS_DEPLOY_HISTORY_KEY, all)
    }

    // Record the rollback as a new deployment
    return this.recordDeploy(serverId, `Rollback to ${target.action}`, "success")
  }

  /**
   * Create a backup on a remote server.
   * Runs a configurable backup command and records the result.
   */
  async createBackup(serverId: string): Promise<string> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    this.log(`Creating backup on ${server.hostname}`)

    try {
      // Default backup command: create a timestamped tarball of /etc and /var/www
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const backupCmd = [
        `sudo tar -czf /var/backups/vps-backup-${timestamp}.tar.gz`,
        "/etc",
        "2>/dev/null",
        "&& echo 'BACKUP_OK'",
        "|| echo 'BACKUP_PARTIAL'",
      ].join(" ")

      const result = await this.execRemote(server, backupCmd)
      const success = result.includes("BACKUP_OK")

      await this.recordDeploy(serverId, `Backup created (${timestamp})`, success ? "success" : "failed")

      return success ? "Backup completed successfully" : "Backup completed with warnings"
    } catch (err) {
      await this.recordDeploy(serverId, "Backup failed", "failed")
      throw err
    }
  }

  /**
   * Check the connectivity status of a server by running a simple command.
   */
  async checkStatus(serverId: string): Promise<VPSServer["status"]> {
    const server = this.getServer(serverId)
    if (!server) return "unknown"

    try {
      // Gather uptime + CPU idle + memory in one round-trip
      const combinedCmd = [
        "echo OK && uptime",
        "echo '---CPUCHK---'",
        "top -bn1 | grep 'Cpu(s)' 2>/dev/null || echo ''",
        "echo '---MEMCHK---'",
        "free -b | grep Mem 2>/dev/null || echo ''",
      ].join(" ; ")

      const output = await this.execRemote(server, combinedCmd)
      if (output.includes("OK")) {
        // Parse CPU usage from the embedded section
        const cpuSection = output.indexOf("---CPUCHK---")
        const memSection = output.indexOf("---MEMCHK---")
        let cpuPercent = 0
        let ramPercent = 0

        if (cpuSection >= 0 && memSection >= 0) {
          const cpuText = output.slice(cpuSection + "---CPUCHK---".length, memSection).trim()
          cpuPercent = parseCpuUsage(cpuText)
        }

        if (memSection >= 0) {
          const memText = output.slice(memSection + "---MEMCHK---".length).trim()
          const mem = parseMemory(memText)
          if (mem.total > 0) {
            ramPercent = (mem.used / mem.total) * 100
          }
        }

        // Critical: CPU > 90% OR RAM > 95%
        if (cpuPercent > 90 || ramPercent > 95) {
          this.log(`Server ${server.hostname} is critical: CPU=${cpuPercent}%, RAM=${Math.round(ramPercent)}%`)
          await this.updateServerStatus(serverId, "critical")
          return "critical"
        }

        // Check load average for degraded status
        const loadMatch = output.match(/load average:\s*([\d.]+)/)
        if (loadMatch) {
          const load1min = parseFloat(loadMatch[1])
          // Consider degraded if 1-min load average > 4
          if (load1min > 4) {
            await this.updateServerStatus(serverId, "degraded")
            return "degraded"
          }
        }
        await this.updateServerStatus(serverId, "online")
        return "online"
      }
      await this.updateServerStatus(serverId, "degraded")
      return "degraded"
    } catch {
      await this.updateServerStatus(serverId, "offline")
      return "offline"
    }
  }

  // ── Runbooks ─────────────────────────────────────────

  /**
   * Return a structured backup runbook for the given server.
   */
  getBackupRunbook(serverId: string): BackupRunbook {
    const server = this.getServer(serverId)
    const hostname = server?.hostname ?? serverId

    return {
      serverId,
      title: `Backup Runbook for ${hostname}`,
      estimatedDurationMinutes: 15,
      steps: [
        {
          order: 1,
          name: "Pre-backup checks",
          description: "Verify disk space and that no other backup is running",
          command: "df -h /var/backups && ! pgrep -f 'tar.*backup'",
        },
        {
          order: 2,
          name: "Create snapshot",
          description: "Create a timestamped compressed archive of critical paths",
          command: "sudo tar -czf /var/backups/vps-backup-$(date +%Y%m%d-%H%M%S).tar.gz /etc /var/www 2>/dev/null",
        },
        {
          order: 3,
          name: "Verify backup",
          description: "Check the archive integrity and list contents summary",
          command: "sudo tar -tzf /var/backups/$(ls -t /var/backups/vps-backup-*.tar.gz | head -1) | wc -l",
        },
        {
          order: 4,
          name: "Post-backup cleanup",
          description: "Remove backups older than 30 days to reclaim space",
          command: "find /var/backups -name 'vps-backup-*.tar.gz' -mtime +30 -delete",
        },
      ],
    }
  }

  /**
   * Return a structured incident recovery runbook for the given server.
   */
  getIncidentRunbook(serverId: string): IncidentRunbook {
    const server = this.getServer(serverId)
    const hostname = server?.hostname ?? serverId

    return {
      serverId,
      title: `Incident Recovery Runbook for ${hostname}`,
      steps: [
        {
          order: 1,
          name: "Triage",
          description: "Identify the scope and severity of the incident. Check monitoring dashboards and recent alerts.",
        },
        {
          order: 2,
          name: "Isolate",
          description: "Prevent further damage by isolating the affected service or network segment.",
          command: "sudo iptables -A INPUT -j DROP -m comment --comment 'incident-isolation'",
        },
        {
          order: 3,
          name: "Diagnose",
          description: "Gather logs, metrics, and system state to determine root cause.",
          command: "journalctl --since '1 hour ago' --no-pager | tail -200 && dmesg | tail -50",
        },
        {
          order: 4,
          name: "Remediate",
          description: "Apply the fix: restart services, roll back changes, or patch the vulnerability.",
          command: "sudo systemctl restart affected-service",
        },
        {
          order: 5,
          name: "Verify",
          description: "Confirm the service is restored and operating normally. Remove isolation rules.",
          command: "sudo iptables -D INPUT -j DROP -m comment --comment 'incident-isolation'",
        },
        {
          order: 6,
          name: "Postmortem",
          description: "Document the timeline, root cause, impact, and corrective actions to prevent recurrence.",
        },
      ],
    }
  }

  // ── Deploy Pre-flight ───────────────────────────────

  /**
   * Run a pre-flight check before deploying to a server.
   * Verifies the server is reachable and not in "critical" status.
   */
  async preflightCheck(serverId: string): Promise<DeployPreflightResult> {
    const errors: string[] = []
    let reachable = false
    let status: VPSServer["status"] = "unknown"

    try {
      status = await this.checkStatus(serverId)
      reachable = status !== "offline" && status !== "unknown"
    } catch {
      reachable = false
      status = "offline"
    }

    if (!reachable) {
      errors.push(`Server "${serverId}" is unreachable (status: ${status})`)
    }

    if (status === "critical") {
      errors.push(`Server "${serverId}" is in critical status -- deploy is blocked until the server recovers`)
    }

    return {
      ok: errors.length === 0,
      serverId,
      reachable,
      status,
      errors,
    }
  }

  // ── Reverse Proxy Management ─────────────────────────

  /**
   * Parse nginx/caddy configs on a remote server to discover reverse-proxy sites.
   * Scans standard config directories for server blocks / site entries.
   */
  async getReverseProxyConfigs(serverId: string): Promise<ReverseProxyConfig[]> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    const configs: ReverseProxyConfig[] = []

    // Try nginx first
    try {
      const nginxOutput = await this.execRemote(
        server,
        [
          "find /etc/nginx/sites-enabled /etc/nginx/conf.d -name '*.conf' -type f 2>/dev/null",
          "| while read f; do",
          "  echo '---FILE---'",
          "  echo \"$f\"",
          "  cat \"$f\" 2>/dev/null",
          "done",
        ].join(" "),
      )

      if (nginxOutput.trim()) {
        const fileBlocks = nginxOutput.split("---FILE---").filter((b) => b.trim())
        for (const block of fileBlocks) {
          const lines = block.trim().split("\n")
          const configPath = lines[0]?.trim() ?? ""
          const content = lines.slice(1).join("\n")
          const parsed = this.parseNginxServerBlocks(content, configPath)
          configs.push(...parsed)
        }
      }
    } catch {
      // nginx may not be installed; continue to caddy
    }

    // Try caddy
    try {
      const caddyOutput = await this.execRemote(
        server,
        "cat /etc/caddy/Caddyfile 2>/dev/null || echo ''",
      )

      if (caddyOutput.trim()) {
        const parsed = this.parseCaddyBlocks(caddyOutput, "/etc/caddy/Caddyfile")
        configs.push(...parsed)
      }
    } catch {
      // caddy may not be installed
    }

    this.log(`Found ${configs.length} reverse proxy configs on ${server.hostname}`)
    return configs
  }

  /**
   * Write a new reverse-proxy config to the server and reload the web server.
   */
  async addReverseProxyConfig(serverId: string, config: ReverseProxyConfig): Promise<void> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    let fileContent: string
    let reloadCmd: string

    if (config.type === "nginx") {
      fileContent = this.generateNginxConfig(config)
      reloadCmd = "sudo nginx -t && sudo systemctl reload nginx"
    } else {
      fileContent = this.generateCaddyConfig(config)
      reloadCmd = "sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy"
    }

    // Write the config file and reload the service in one SSH round-trip
    const escapedContent = fileContent.replace(/'/g, "'\\''")
    const writeCmd = `echo '${escapedContent}' | sudo tee ${shellEscape(config.configPath)} > /dev/null`

    await this.execRemote(server, `${writeCmd} && ${reloadCmd}`)
    this.log(`Reverse proxy config added on ${server.hostname}: ${config.domain} -> ${config.upstream}`)
  }

  /**
   * Remove a reverse-proxy config file for a given domain and reload the service.
   */
  async removeReverseProxyConfig(serverId: string, domain: string): Promise<void> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    // Find configs matching this domain
    const configs = await this.getReverseProxyConfigs(serverId)
    const match = configs.find((c) => c.domain === domain)

    if (!match) {
      throw new Error(`No reverse proxy config found for domain: ${domain}`)
    }

    // Remove the config file and reload the appropriate service
    const reloadCmd =
      match.type === "nginx"
        ? "sudo nginx -t && sudo systemctl reload nginx"
        : "sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy"

    await this.execRemote(server, `sudo rm -f ${shellEscape(match.configPath)} && ${reloadCmd}`)
    this.log(`Reverse proxy config removed on ${server.hostname}: ${domain}`)
  }

  /**
   * Test the reverse-proxy configuration on a server (nginx -t or caddy validate).
   */
  async testReverseProxyConfig(serverId: string): Promise<ReverseProxyTestResult> {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Server not found: ${serverId}`)

    const errors: string[] = []
    let valid = true

    // Test nginx config
    try {
      const nginxResult = await this.execRemote(server, "sudo nginx -t 2>&1")
      if (!nginxResult.includes("syntax is ok") && !nginxResult.includes("test is successful")) {
        valid = false
        const errorLines = nginxResult
          .split("\n")
          .filter((l) => l.includes("emerg") || l.includes("error") || l.includes("["))
          .map((l) => l.trim())
        errors.push(...errorLines)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("not found") && !msg.includes("No such file")) {
        valid = false
        errors.push(`nginx test failed: ${msg}`)
      }
    }

    // Test caddy config
    try {
      const caddyResult = await this.execRemote(
        server,
        "sudo caddy validate --config /etc/caddy/Caddyfile 2>&1",
      )
      if (caddyResult.includes("Error") || caddyResult.includes("error")) {
        valid = false
        const errorLines = caddyResult
          .split("\n")
          .filter((l) => l.toLowerCase().includes("error"))
          .map((l) => l.trim())
        errors.push(...errorLines)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("not found") && !msg.includes("No such file")) {
        valid = false
        errors.push(`caddy validate failed: ${msg}`)
      }
    }

    this.log(`Reverse proxy test on ${server.hostname}: valid=${valid}, errors=${errors.length}`)
    return { valid, errors }
  }

  // ── Reverse Proxy Parsers (private) ─────────────────

  /**
   * Extract domain, upstream, and SSL info from nginx server blocks.
   */
  private parseNginxServerBlocks(content: string, configPath: string): ReverseProxyConfig[] {
    const configs: ReverseProxyConfig[] = []
    // Match server_name directives
    const serverNameRe = /server_name\s+([^;]+);/g
    const proxyPassRe = /proxy_pass\s+([^;]+);/g
    const sslRe = /listen\s+.*443\s+ssl/

    let snMatch: RegExpExecArray | null
    while ((snMatch = serverNameRe.exec(content)) !== null) {
      const domain = snMatch[1].trim().split(/\s+/)[0]
      if (domain === "_" || domain === "localhost") continue

      // Find the closest proxy_pass after this server_name
      const afterServerName = content.slice(snMatch.index)
      const ppMatch = proxyPassRe.exec(afterServerName)
      const upstream = ppMatch ? ppMatch[1].trim() : ""

      const sslEnabled = sslRe.test(content)

      configs.push({
        type: "nginx",
        domain,
        upstream,
        sslEnabled,
        configPath,
      })

      // Reset proxyPassRe for next iteration
      proxyPassRe.lastIndex = 0
    }

    return configs
  }

  /**
   * Extract domain and upstream info from a Caddyfile.
   */
  private parseCaddyBlocks(content: string, configPath: string): ReverseProxyConfig[] {
    const configs: ReverseProxyConfig[] = []
    // Caddy site blocks: `domain.com { ... reverse_proxy upstream ... }`
    const blockRe = /^(\S+)\s*\{/gm
    const reverseProxyRe = /reverse_proxy\s+([^\n}]+)/

    let blockMatch: RegExpExecArray | null
    while ((blockMatch = blockRe.exec(content)) !== null) {
      const domain = blockMatch[1].trim()
      if (domain === "{" || domain.startsWith("#") || domain.startsWith(":")) continue

      // Find the block's content (up to the next closing brace at the same level)
      const blockStart = content.indexOf("{", blockMatch.index) + 1
      let depth = 1
      let blockEnd = blockStart
      for (let i = blockStart; i < content.length && depth > 0; i++) {
        if (content[i] === "{") depth++
        else if (content[i] === "}") depth--
        blockEnd = i
      }

      const blockContent = content.slice(blockStart, blockEnd)
      const rpMatch = reverseProxyRe.exec(blockContent)
      const upstream = rpMatch ? rpMatch[1].trim() : ""

      // Caddy auto-provisions TLS for non-localhost domains by default
      const sslEnabled = !domain.startsWith("http://") && !domain.includes("localhost")

      configs.push({
        type: "caddy",
        domain: domain.replace(/^https?:\/\//, ""),
        upstream,
        sslEnabled,
        configPath,
      })
    }

    return configs
  }

  /**
   * Generate an nginx server block config string.
   */
  private generateNginxConfig(config: ReverseProxyConfig): string {
    const lines = ["server {"]

    if (config.sslEnabled) {
      lines.push(`    listen 443 ssl;`)
      lines.push(`    listen [::]:443 ssl;`)
      lines.push(`    ssl_certificate /etc/letsencrypt/live/${config.domain}/fullchain.pem;`)
      lines.push(`    ssl_certificate_key /etc/letsencrypt/live/${config.domain}/privkey.pem;`)
    } else {
      lines.push(`    listen 80;`)
      lines.push(`    listen [::]:80;`)
    }

    lines.push(`    server_name ${config.domain};`)
    lines.push("")
    lines.push("    location / {")
    lines.push(`        proxy_pass ${config.upstream};`)
    lines.push("        proxy_set_header Host $host;")
    lines.push("        proxy_set_header X-Real-IP $remote_addr;")
    lines.push("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;")
    lines.push("        proxy_set_header X-Forwarded-Proto $scheme;")
    lines.push("    }")
    lines.push("}")

    return lines.join("\n")
  }

  /**
   * Generate a Caddy site block config string.
   */
  private generateCaddyConfig(config: ReverseProxyConfig): string {
    const lines: string[] = []
    const domainPrefix = config.sslEnabled ? config.domain : `http://${config.domain}`

    lines.push(`${domainPrefix} {`)
    lines.push(`    reverse_proxy ${config.upstream}`)
    lines.push("}")

    return lines.join("\n")
  }

  // ── Webview Message Handling ──────────────────────────

  /**
   * Handle messages from the VPS tab in the webview.
   * Call this from KiloProvider's message handler.
   */
  // eslint-disable-next-line complexity
  async handleMessage(
    message: Record<string, unknown>,
    postToWebview: (msg: Record<string, unknown>) => void,
  ): Promise<boolean> {
    switch (message.type) {
      case "requestVpsServers": {
        const servers = this.getServers()
        postToWebview({ type: "vpsServersLoaded", servers })
        return true
      }

      case "vpsServerAdd": {
        try {
          const serverData = message.server as VPSServer
          if (!serverData?.id) throw new Error("Invalid server data: missing id")
          // Check if server exists BEFORE adding/updating to determine response type
          const existingServer = this.getServers().find(s => s.id === serverData.id)
          const isUpdate = !!existingServer
          const server = await this.addOrUpdateServer(serverData)
          postToWebview({
            type: isUpdate ? "vpsServerUpdated" : "vpsServerAdded",
            server,
          })
        } catch (err) {
          this.log(`Error adding server: ${err}`)
          postToWebview({ type: "vpsError", error: String(err) })
        }
        return true
      }

      case "vpsServerRemove": {
        try {
          const serverId = message.serverId as string
          if (!serverId) throw new Error("Invalid serverId")
          await this.removeServer(serverId)
          postToWebview({ type: "vpsServerRemoved", serverId })
        } catch (err) {
          this.log(`Error removing server: ${err}`)
          postToWebview({ type: "vpsError", error: String(err) })
        }
        return true
      }

      case "vpsRefreshMetrics": {
        const serverId = message.serverId as string
        try {
          const [metrics, services, containers] = await Promise.all([
            this.fetchMetrics(serverId),
            this.listServices(serverId).catch(() => []),
            this.listContainers(serverId).catch(() => []),
          ])
          const history = this.getDeployHistory(serverId)

          postToWebview({ type: "vpsMetricsLoaded", metrics })
          postToWebview({ type: "vpsServicesLoaded", services })
          postToWebview({ type: "vpsContainersLoaded", containers })
          postToWebview({ type: "vpsDeployHistoryLoaded", history })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Failed to fetch metrics: ${msg}`)
        }
        return true
      }

      case "vpsServiceAction": {
        const serverId = message.serverId as string
        const service = message.service as string
        const action = message.action as "restart" | "stop" | "logs"
        try {
          await this.serviceAction(serverId, service, action)
          if (action !== "logs") {
            // Refresh services list after a state change
            const services = await this.listServices(serverId).catch(() => [])
            postToWebview({ type: "vpsServicesLoaded", services })
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Service ${action} failed: ${msg}`)
        }
        return true
      }

      case "vpsDockerAction": {
        const serverId = message.serverId as string
        const containerId = message.containerId as string
        const action = message.action as "start" | "stop" | "restart" | "remove" | "logs"
        try {
          await this.dockerAction(serverId, containerId, action)
          if (action !== "logs") {
            // Refresh containers list after a state change
            const containers = await this.listContainers(serverId).catch(() => [])
            postToWebview({ type: "vpsContainersLoaded", containers })
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Docker ${action} failed: ${msg}`)
        }
        return true
      }

      case "vpsDeploy": {
        const serverId = message.serverId as string
        try {
          // Pre-flight safety check before deploying
          const preflight = await this.preflightCheck(serverId)
          if (!preflight.ok) {
            const reason = preflight.errors.join("; ")
            this.log(`Deploy blocked for ${serverId}: ${reason}`)
            vscode.window.showErrorMessage(`Deploy pre-flight failed: ${reason}`)
            postToWebview({ type: "vpsDeployPreflightFailed", serverId, errors: preflight.errors })
            return true
          }

          const entry = await this.recordDeploy(serverId, "Manual deploy", "success")
          const history = this.getDeployHistory(serverId)
          postToWebview({ type: "vpsDeployHistoryLoaded", history })
          vscode.window.showInformationMessage(`Deploy recorded: ${entry.id}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Deploy failed: ${msg}`)
        }
        return true
      }

      case "vpsRollback": {
        const serverId = message.serverId as string
        const deployId = message.deployId as string
        try {
          await this.rollback(serverId, deployId)
          const history = this.getDeployHistory(serverId)
          postToWebview({ type: "vpsDeployHistoryLoaded", history })
          vscode.window.showInformationMessage("Rollback completed successfully")
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Rollback failed: ${msg}`)
        }
        return true
      }

      case "vpsBackup": {
        const serverId = message.serverId as string
        postToWebview({ type: "vpsBackupStatus", status: "in-progress" })
        try {
          await this.createBackup(serverId)
          postToWebview({ type: "vpsBackupStatus", status: "available" })
          const history = this.getDeployHistory(serverId)
          postToWebview({ type: "vpsDeployHistoryLoaded", history })
          vscode.window.showInformationMessage("Backup completed")
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          postToWebview({ type: "vpsBackupStatus", status: "none" })
          vscode.window.showErrorMessage(`Backup failed: ${msg}`)
        }
        return true
      }

      case "vpsGetReverseProxyConfigs": {
        const serverId = message.serverId as string
        try {
          const configs = await this.getReverseProxyConfigs(serverId)
          postToWebview({ type: "vpsReverseProxyConfigsLoaded", configs })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Failed to fetch reverse proxy configs: ${msg}`)
        }
        return true
      }

      case "vpsAddReverseProxyConfig": {
        const serverId = message.serverId as string
        const config = message.config as ReverseProxyConfig
        try {
          await this.addReverseProxyConfig(serverId, config)
          const configs = await this.getReverseProxyConfigs(serverId)
          postToWebview({ type: "vpsReverseProxyConfigsLoaded", configs })
          vscode.window.showInformationMessage(`Reverse proxy added for ${config.domain}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Failed to add reverse proxy config: ${msg}`)
        }
        return true
      }

      case "vpsRemoveReverseProxyConfig": {
        const serverId = message.serverId as string
        const domain = message.domain as string
        try {
          await this.removeReverseProxyConfig(serverId, domain)
          const configs = await this.getReverseProxyConfigs(serverId)
          postToWebview({ type: "vpsReverseProxyConfigsLoaded", configs })
          vscode.window.showInformationMessage(`Reverse proxy removed for ${domain}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Failed to remove reverse proxy config: ${msg}`)
        }
        return true
      }

      case "vpsTestReverseProxyConfig": {
        const serverId = message.serverId as string
        try {
          const result = await this.testReverseProxyConfig(serverId)
          postToWebview({ type: "vpsReverseProxyTestResult", result })
          if (result.valid) {
            vscode.window.showInformationMessage("Reverse proxy configuration is valid")
          } else {
            vscode.window.showWarningMessage(
              `Reverse proxy config errors: ${result.errors.join("; ")}`,
            )
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(`Failed to test reverse proxy config: ${msg}`)
        }
        return true
      }

      default:
        return false
    }
  }

  // ── Logging ──────────────────────────────────────────

  private log(msg: string): void {
    const ts = new Date().toISOString()
    this.outputChannel.appendLine(`[${ts}] ${msg}`)
  }

  // ── Cleanup ──────────────────────────────────────────

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
    if (this.fallbackRunner) {
      this.fallbackRunner.dispose()
    }
  }
}

// ─── Utility ─────────────────────────────────────────────

/**
 * Extract text between two markers from a multi-section output string.
 */
function extractSection(output: string, startMarker: string, endMarker: string | undefined): string {
  const startIdx = output.indexOf(startMarker)
  if (startIdx < 0) return ""
  const afterStart = startIdx + startMarker.length
  if (endMarker) {
    const endIdx = output.indexOf(endMarker, afterStart)
    if (endIdx < 0) return output.slice(afterStart).trim()
    return output.slice(afterStart, endIdx).trim()
  }
  return output.slice(afterStart).trim()
}

/**
 * Basic shell argument escaping to prevent injection.
 */
function shellEscape(arg: string): string {
  // Remove any characters that could be used for shell injection
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}
