/**
 * vps-webview.ts
 *
 * Bridges webview messages from VPSTab.tsx → VPS server state (persisted in
 * ExtensionContext workspaceState) + SSH-based metric collection.
 *
 * Server inventory is persisted locally so it survives reloads without a
 * running backend. Metric collection / service / docker actions are forwarded
 * via SSH using the server's configured sshProfile.
 *
 * Message types handled:
 *   requestVpsServers      → load inventory, push vpsServersLoaded
 *   vpsAddServer           → add server to inventory, push vpsServersLoaded
 *   vpsUpdateServer        → update server in inventory, push vpsServersLoaded
 *   vpsRemoveServer        → remove server from inventory, push vpsServersLoaded
 *   requestVpsMetrics      → collect metrics via SSH, push vpsMetricsLoaded + vpsServicesLoaded + vpsContainersLoaded
 *   vpsServiceAction       → run systemctl action via SSH, push vpsActionResult
 *   vpsDockerAction        → run docker action via SSH, push vpsActionResult + vpsContainersLoaded
 *   vpsTriggerDeploy       → trigger deploy script via SSH, push vpsDeployResult
 *   vpsCreateBackup        → trigger backup script via SSH, push vpsBackupResult
 *   vpsRollbackDeploy      → trigger rollback script via SSH, push vpsDeployResult
 */

import * as vscode from "vscode"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

const SERVERS_KEY = "vps.servers"
const DEPLOY_HISTORY_KEY = "vps.deployHistory"

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

interface DeployEntry {
  id: string
  timestamp: number
  action: string
  status: "success" | "failed" | "in-progress"
  rollbackAvailable: boolean
}

export interface VPSWebviewContext {
  extensionContext: vscode.ExtensionContext
  postMessage: (msg: unknown) => void
}

function loadServers(ctx: VPSWebviewContext): VPSServer[] {
  return ctx.extensionContext.workspaceState.get<VPSServer[]>(SERVERS_KEY, [])
}

function saveServers(ctx: VPSWebviewContext, servers: VPSServer[]): Thenable<void> {
  return ctx.extensionContext.workspaceState.update(SERVERS_KEY, servers)
}

function loadDeployHistory(ctx: VPSWebviewContext): DeployEntry[] {
  return ctx.extensionContext.workspaceState.get<DeployEntry[]>(DEPLOY_HISTORY_KEY, [])
}

function saveDeployHistory(ctx: VPSWebviewContext, history: DeployEntry[]): Thenable<void> {
  return ctx.extensionContext.workspaceState.update(DEPLOY_HISTORY_KEY, history.slice(0, 100))
}

async function sshRun(
  server: VPSServer,
  command: string,
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string }> {
  const target = server.sshProfile || `${server.ip}`
  const { stdout, stderr } = await execFileAsync(
    "ssh",
    ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no", target, command],
    { timeout: timeoutMs },
  )
  return { stdout, stderr }
}

function parseMetrics(stdout: string, serverId: string) {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean)
  let cpu = 0
  let ramUsed = 0
  let ramTotal = 0
  const disks: Array<{ mount: string; used: number; total: number }> = []

  for (const line of lines) {
    if (line.startsWith("CPU:")) cpu = parseFloat(line.split(":")[1] ?? "0")
    else if (line.startsWith("RAM:")) {
      const parts = line.split(":")[1]?.split("/") ?? []
      ramUsed = parseInt(parts[0] ?? "0", 10)
      ramTotal = parseInt(parts[1] ?? "0", 10)
    } else if (line.startsWith("DISK:")) {
      const parts = line.split(":")[1]?.split(",") ?? []
      disks.push({
        mount: parts[0]?.trim() ?? "/",
        used: parseInt(parts[1] ?? "0", 10),
        total: parseInt(parts[2] ?? "0", 10),
      })
    }
  }
  return { serverId, cpu, ramUsed, ramTotal, disks, timestamp: Date.now() }
}

function parseServices(stdout: string) {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/)
      return {
        name: parts[0] ?? "",
        status: (parts[1] ?? "unknown") as "running" | "stopped" | "failed",
        pid: parseInt(parts[2] ?? "0", 10),
        cpuPercent: parseFloat(parts[3] ?? "0"),
        memPercent: parseFloat(parts[4] ?? "0"),
      }
    })
    .filter((s) => s.name.length > 0)
}

function parseContainers(stdout: string) {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|")
      return {
        id: parts[0]?.trim() ?? "",
        name: parts[1]?.trim() ?? "",
        image: parts[2]?.trim() ?? "",
        status: parts[3]?.trim() ?? "",
        ports: (parts[4]?.trim() ?? "").split(",").map((p) => p.trim()).filter(Boolean),
      }
    })
    .filter((c) => c.id.length > 0)
}

const METRICS_SCRIPT = [
  "echo CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | tr -d '%us,')",
  "MEM=$(free -m | awk '/^Mem/{print $3\"/\"$2}'); echo RAM:$MEM",
  "df -BM --output=target,used,size | tail -n+2 | awk '{gsub(/M/,\"\",$2); gsub(/M/,\"\",$3); print \"DISK:\"$1\",\"$2\",\"$3}'",
].join("; ")

const SERVICES_SCRIPT =
  "systemctl list-units --type=service --state=running --no-legend --no-pager | awk '{print $1\" running 0 0 0}' | head -20"

const CONTAINERS_SCRIPT =
  "docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null || true"

// eslint-disable-next-line complexity
export async function handleVpsWebviewMessage(
  msg: Record<string, unknown>,
  ctx: VPSWebviewContext,
): Promise<boolean> {
  switch (msg.type) {
    case "requestVpsServers": {
      const servers = loadServers(ctx)
      const history = loadDeployHistory(ctx)
      ctx.postMessage({ type: "vpsServersLoaded", servers })
      ctx.postMessage({ type: "vpsDeployHistoryLoaded", history })
      return true
    }

    case "vpsAddServer": {
      const servers = loadServers(ctx)
      const server: VPSServer = {
        id: msg.id as string,
        hostname: (msg.hostname as string) ?? "",
        ip: (msg.ip as string) ?? "",
        sshProfile: (msg.sshProfile as string) ?? "",
        os: (msg.os as string) ?? "linux",
        region: (msg.region as string) ?? "",
        tags: (msg.tags as string[]) ?? [],
        status: "unknown",
      }
      servers.push(server)
      await saveServers(ctx, servers)
      ctx.postMessage({ type: "vpsServersLoaded", servers })
      return true
    }

    case "vpsUpdateServer": {
      const servers = loadServers(ctx)
      const idx = servers.findIndex((s) => s.id === msg.id)
      if (idx >= 0) {
        servers[idx] = { ...servers[idx], ...(msg as Partial<VPSServer>) } as VPSServer
        await saveServers(ctx, servers)
      }
      ctx.postMessage({ type: "vpsServersLoaded", servers })
      return true
    }

    case "vpsRemoveServer": {
      let servers = loadServers(ctx)
      servers = servers.filter((s) => s.id !== (msg.serverId as string))
      await saveServers(ctx, servers)
      ctx.postMessage({ type: "vpsServersLoaded", servers })
      return true
    }

    case "requestVpsMetrics": {
      const servers = loadServers(ctx)
      const server = servers.find((s) => s.id === (msg.serverId as string))
      if (!server) {
        ctx.postMessage({ type: "vpsError", error: "Server not found" })
        return true
      }
      try {
        const [metricsOut, servicesOut, containersOut] = await Promise.allSettled([
          sshRun(server, METRICS_SCRIPT),
          sshRun(server, SERVICES_SCRIPT),
          sshRun(server, CONTAINERS_SCRIPT),
        ])

        if (metricsOut.status === "fulfilled") {
          ctx.postMessage({ type: "vpsMetricsLoaded", metrics: parseMetrics(metricsOut.value.stdout, server.id) })
        }
        if (servicesOut.status === "fulfilled") {
          ctx.postMessage({ type: "vpsServicesLoaded", services: parseServices(servicesOut.value.stdout) })
        }
        if (containersOut.status === "fulfilled") {
          ctx.postMessage({ type: "vpsContainersLoaded", containers: parseContainers(containersOut.value.stdout) })
        }

        const allOk = [metricsOut, servicesOut, containersOut].every((r) => r.status === "fulfilled")
        server.status = allOk ? "online" : "degraded"
        await saveServers(ctx, servers)
        ctx.postMessage({ type: "vpsServersLoaded", servers })
      } catch (e) {
        server.status = "offline"
        await saveServers(ctx, servers)
        ctx.postMessage({ type: "vpsServersLoaded", servers })
        ctx.postMessage({ type: "vpsError", error: e instanceof Error ? e.message : String(e) })
      }
      return true
    }

    case "vpsServiceAction": {
      const servers = loadServers(ctx)
      const server = servers.find((s) => s.id === (msg.serverId as string))
      if (!server) return true
      const svc = msg.service as string
      const action = msg.action as string
      try {
        const { stdout } = await sshRun(server, `sudo systemctl ${action} ${svc} 2>&1 || true`, 20_000)
        ctx.postMessage({ type: "vpsActionResult", service: svc, action, output: stdout, success: true })
      } catch (e) {
        ctx.postMessage({ type: "vpsActionResult", service: svc, action, output: "", success: false, error: e instanceof Error ? e.message : String(e) })
      }
      return true
    }

    case "vpsDockerAction": {
      const servers = loadServers(ctx)
      const server = servers.find((s) => s.id === (msg.serverId as string))
      if (!server) return true
      const containerId = msg.containerId as string
      const action = msg.action as string
      const dockerCmd = action === "logs"
        ? `docker logs --tail 100 ${containerId} 2>&1`
        : `docker ${action} ${containerId} 2>&1`
      try {
        const { stdout } = await sshRun(server, dockerCmd, 20_000)
        ctx.postMessage({ type: "vpsActionResult", containerId, action, output: stdout, success: true })
        if (action !== "logs") {
          const { stdout: listOut } = await sshRun(server, CONTAINERS_SCRIPT)
          ctx.postMessage({ type: "vpsContainersLoaded", containers: parseContainers(listOut) })
        }
      } catch (e) {
        ctx.postMessage({ type: "vpsActionResult", containerId, action, output: "", success: false, error: e instanceof Error ? e.message : String(e) })
      }
      return true
    }

    case "vpsTriggerDeploy": {
      const servers = loadServers(ctx)
      const server = servers.find((s) => s.id === (msg.serverId as string))
      if (!server) return true
      const entryId = `deploy-${Date.now()}`
      const history = loadDeployHistory(ctx)
      const entry: DeployEntry = { id: entryId, timestamp: Date.now(), action: "deploy", status: "in-progress", rollbackAvailable: false }
      history.unshift(entry)
      await saveDeployHistory(ctx, history)
      ctx.postMessage({ type: "vpsDeployHistoryLoaded", history })
      try {
        const { stdout } = await sshRun(server, "bash ~/deploy.sh 2>&1 || true", 120_000)
        entry.status = "success"
        entry.rollbackAvailable = true
        ctx.postMessage({ type: "vpsDeployResult", success: true, output: stdout })
      } catch (e) {
        entry.status = "failed"
        ctx.postMessage({ type: "vpsDeployResult", success: false, error: e instanceof Error ? e.message : String(e) })
      }
      await saveDeployHistory(ctx, history)
      ctx.postMessage({ type: "vpsDeployHistoryLoaded", history })
      return true
    }

    case "vpsCreateBackup": {
      const servers = loadServers(ctx)
      const server = servers.find((s) => s.id === (msg.serverId as string))
      if (!server) return true
      try {
        const { stdout } = await sshRun(server, "bash ~/backup.sh 2>&1 || true", 120_000)
        ctx.postMessage({ type: "vpsBackupResult", success: true, output: stdout })
      } catch (e) {
        ctx.postMessage({ type: "vpsBackupResult", success: false, error: e instanceof Error ? e.message : String(e) })
      }
      return true
    }

    case "vpsRollbackDeploy": {
      const servers = loadServers(ctx)
      const server = servers.find((s) => s.id === (msg.serverId as string))
      if (!server) return true
      try {
        const { stdout } = await sshRun(server, `bash ~/rollback.sh ${msg.deployId ?? ""} 2>&1 || true`, 120_000)
        ctx.postMessage({ type: "vpsDeployResult", success: true, output: stdout })
      } catch (e) {
        ctx.postMessage({ type: "vpsDeployResult", success: false, error: e instanceof Error ? e.message : String(e) })
      }
      return true
    }

    default:
      return false
  }
}
