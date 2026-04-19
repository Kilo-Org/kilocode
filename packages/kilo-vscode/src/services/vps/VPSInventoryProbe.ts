import { KiloLogger } from "../KiloLogger"
import type { SSHService } from "../ssh/SSHService"

// ─── Types ───────────────────────────────────────────────

/**
 * A snapshot of read-only metadata for a remote VPS host.
 *
 * All fields are optional: the probe runs each command independently and
 * skips fields whose command times out or errors. Callers should treat a
 * missing field as "unknown", not as "absent".
 */
export interface ServerInventory {
  /** Profile name that was probed (for cross-referencing with SSHProfile). */
  profileName: string
  /** Unix ms timestamp when the probe finished. */
  probedAt: number

  // Host identity
  hostname?: string
  distro?: string
  kernel?: string
  uptime?: string

  // CPU / memory / disk
  cpuModel?: string
  cpuCores?: number
  ramTotalMb?: number
  ramUsedMb?: number
  diskTotalGb?: number
  diskUsedGb?: number

  // Networking
  publicIp?: string

  // Docker
  dockerInstalled?: boolean
  dockerVersion?: string
  dockerContainers?: string[]

  // systemd services
  services?: string[]

  // Reverse proxies
  nginxInstalled?: boolean
  caddyInstalled?: boolean
}

/**
 * The probe runs a `runCommand(profileName, command)` against an SSH service.
 * Using a narrow structural type so we don't tightly couple to one SSHService
 * implementation -- any object exposing runCommand() will satisfy the contract.
 */
interface SSHCommandRunner {
  runCommand(profileName: string, command: string): Promise<string>
}

// ─── Constants ───────────────────────────────────────────

/** Max milliseconds any single probe command may run before we give up on it. */
const PROBE_TIMEOUT_MS = 3000

// ─── Service ─────────────────────────────────────────────

/**
 * VPSInventoryProbe
 *
 * Runs safe, read-only shell commands over SSH to auto-collect metadata
 * about a newly connected VPS profile. Every probe command is:
 *   - Bounded by a 3-second timeout
 *   - Wrapped in try/catch so one failure never aborts the whole probe
 *   - Side-effect free (hostname, uname, cat /etc/os-release, free -m, df, etc.)
 *
 * The probe result populates the "Servers" tab so the user no longer sees
 * "No servers registered" after a successful first connection.
 *
 * Usage:
 *   const probe = new VPSInventoryProbe(sshService, KiloLogger.for("VPSInventoryProbe"))
 *   const inventory = await probe.probeServer("my-vps")
 *   await vpsService.addOrUpdateServer(buildServerFromInventory(inventory))
 */
export class VPSInventoryProbe {
  private readonly ssh: SSHCommandRunner
  private readonly log: KiloLogger

  constructor(sshService: SSHService | SSHCommandRunner, logger?: KiloLogger) {
    // Accept either an SSHService or anything with a runCommand(profile, cmd) method.
    this.ssh = sshService as SSHCommandRunner
    this.log = logger ?? KiloLogger.for("VPSInventoryProbe")
  }

  /**
   * Probe a VPS profile and return whatever inventory fields we could collect.
   *
   * All read-only commands run in parallel. If a command fails or times out,
   * its field is simply omitted from the returned ServerInventory -- the
   * probe never throws based on a single command failing.
   */
  async probeServer(profileName: string): Promise<ServerInventory> {
    this.log.info(`Probing VPS "${profileName}"...`)
    const end = this.log.time(`probeServer(${profileName})`)

    // Each entry: [field, command, parser]
    // Parser converts the raw stdout string into the final typed value.
    const probes: Array<{
      key: keyof ServerInventory
      cmd: string
      parse: (raw: string) => unknown
    }> = [
      { key: "hostname", cmd: `hostname`, parse: asTrimmedString },
      {
        key: "distro",
        cmd: `cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2`,
        parse: asTrimmedString,
      },
      { key: "kernel", cmd: `uname -r`, parse: asTrimmedString },
      { key: "uptime", cmd: `uptime -p 2>/dev/null || uptime`, parse: asTrimmedString },
      {
        key: "cpuModel",
        cmd: `cat /proc/cpuinfo | grep "model name" | head -1 | cut -d':' -f2 | xargs`,
        parse: asTrimmedString,
      },
      { key: "cpuCores", cmd: `nproc`, parse: asPositiveInt },
      {
        key: "ramTotalMb",
        cmd: `free -m | awk '/^Mem:/ {print $2}'`,
        parse: asPositiveInt,
      },
      {
        key: "ramUsedMb",
        cmd: `free -m | awk '/^Mem:/ {print $3}'`,
        parse: asPositiveInt,
      },
      {
        key: "diskTotalGb",
        cmd: `df -BG / | awk 'NR==2 {print $2}' | tr -d 'G'`,
        parse: asPositiveInt,
      },
      {
        key: "diskUsedGb",
        cmd: `df -BG / | awk 'NR==2 {print $3}' | tr -d 'G'`,
        parse: asPositiveInt,
      },
      {
        key: "publicIp",
        cmd: `curl -s --max-time 3 ifconfig.me 2>/dev/null || echo unknown`,
        parse: asOptionalIp,
      },
      {
        key: "dockerInstalled",
        cmd: `which docker 2>/dev/null && echo yes || echo no`,
        parse: asYesNoBool,
      },
      {
        key: "dockerVersion",
        cmd: `docker --version 2>/dev/null || echo ""`,
        parse: asOptionalString,
      },
      {
        key: "dockerContainers",
        cmd: `docker ps --format '{{.Names}}' 2>/dev/null | head -20`,
        parse: asLineList,
      },
      {
        key: "services",
        cmd: `systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1}' | head -20`,
        parse: asLineList,
      },
      {
        key: "nginxInstalled",
        cmd: `which nginx 2>/dev/null && echo yes || echo no`,
        parse: asYesNoBool,
      },
      {
        key: "caddyInstalled",
        cmd: `which caddy 2>/dev/null && echo yes || echo no`,
        parse: asYesNoBool,
      },
    ]

    // Kick off every probe in parallel. Each one self-contains its error handling.
    const results = await Promise.all(
      probes.map(async ({ key, cmd, parse }) => {
        try {
          const raw = await this.runWithTimeout(profileName, cmd, PROBE_TIMEOUT_MS)
          const parsed = parse(raw)
          return { key, value: parsed }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.log.debug(`Probe "${String(key)}" failed on ${profileName}: ${msg}`)
          return { key, value: undefined }
        }
      }),
    )

    // Assemble the inventory, skipping fields that came back undefined/empty.
    const inventory: ServerInventory = {
      profileName,
      probedAt: Date.now(),
    }

    for (const { key, value } of results) {
      if (value === undefined || value === null) continue
      if (typeof value === "string" && value.length === 0) continue
      if (Array.isArray(value) && value.length === 0) continue
      // Assign via a narrowly typed cast -- each parser already produced
      // the correct runtime type for its corresponding key.
      ;(inventory as unknown as Record<string, unknown>)[key as string] = value
    }

    this.log.info(
      `Probe complete for "${profileName}": ${Object.keys(inventory).length - 2} fields collected`,
    )
    end()
    return inventory
  }

  // ─── Internal helpers ──────────────────────────────────

  /**
   * Run a single SSH command with a hard timeout. Rejects if the remote
   * command does not produce a result within `timeoutMs`.
   */
  private runWithTimeout(profileName: string, command: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`Probe command timed out after ${timeoutMs}ms: ${command}`))
      }, timeoutMs)

      this.ssh
        .runCommand(profileName, command)
        .then((result) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(result)
        })
        .catch((err: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(err instanceof Error ? err : new Error(String(err)))
        })
    })
  }
}

// ─── Parsers ─────────────────────────────────────────────
//
// Each parser converts raw shell stdout into the final typed value.
// They are deliberately defensive: if the output looks wrong, they
// return undefined so the field is dropped from the inventory.

function asTrimmedString(raw: string): string | undefined {
  const t = raw.trim()
  return t.length > 0 ? t : undefined
}

function asOptionalString(raw: string): string | undefined {
  const t = raw.trim()
  if (t.length === 0) return undefined
  // Some commands echo an empty double-quoted string; filter those out too.
  if (t === '""' || t === "''") return undefined
  return t
}

function asOptionalIp(raw: string): string | undefined {
  const t = raw.trim()
  if (t.length === 0) return undefined
  if (t.toLowerCase() === "unknown") return undefined
  // Quick sanity check: must contain at least one dot or colon (IPv4/IPv6).
  if (!/[.:]/.test(t)) return undefined
  return t
}

function asPositiveInt(raw: string): number | undefined {
  const t = raw.trim()
  if (t.length === 0) return undefined
  const n = parseInt(t, 10)
  if (isNaN(n) || n < 0) return undefined
  return n
}

function asYesNoBool(raw: string): boolean | undefined {
  const t = raw.trim().toLowerCase()
  // The command pattern `which X && echo yes || echo no` prints the binary
  // path followed by "yes" on a new line (or just "no"). We scan the last
  // non-empty line for a yes/no token.
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return undefined
  const last = lines[lines.length - 1]
  if (last === "yes") return true
  if (last === "no") return false
  return undefined
}

function asLineList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}
