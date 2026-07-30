import * as path from "path"
import { createHash } from "crypto"
import { writeFile, chmod, rename, rm } from "fs/promises"
import { fetchProfile } from "@kilocode/kilo-gateway"

export namespace Identity {
  let machineId: string | null = null
  let userId: string | null = null
  let organizationId: string | null = null
  let dataPath = ""

  // Cache the email resolved from the auth token so CLI startup does not block on
  // a profile request for every invocation. Keyed by token hash; refreshed when
  // the token changes. Stale entries (older than a week) are still used for the
  // current run and refreshed on a best-effort basis for a later run: the
  // background refresh is not awaited, so short-lived invocations may exit before
  // it completes and simply retry next time.
  const CACHE_FILE = "telemetry-profile.json"
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

  interface Cache {
    token: string
    email: string
    fetchedAt: number
  }

  export function setDataPath(p: string) {
    dataPath = p
  }

  export async function getMachineId(): Promise<string | undefined> {
    if (machineId) return machineId
    const override = process.env.KILO_MACHINE_ID
    if (override) {
      machineId = override
      return machineId
    }

    // Don't write to the working directory if no data path is configured
    if (!dataPath) return undefined

    const filepath = path.join(dataPath, "telemetry-id")
    const file = Bun.file(filepath)

    if (await file.exists()) {
      machineId = await file.text()
      return machineId
    }

    machineId = crypto.randomUUID()
    await Bun.write(filepath, machineId)
    return machineId
  }

  export function getDistinctId(): string {
    return userId || machineId || "unknown"
  }

  export function getUserId(): string | null {
    return userId
  }

  export function getOrganizationId(): string | null {
    return organizationId
  }

  export function setOrganizationId(orgId: string | null) {
    organizationId = orgId
  }

  function digest(token: string): string {
    return createHash("sha256").update(token).digest("hex")
  }

  async function read(): Promise<Cache | null> {
    if (!dataPath) return null
    const file = Bun.file(path.join(dataPath, CACHE_FILE))
    if (!(await file.exists())) return null
    const parsed = await file.json().catch(() => null)
    if (!parsed || typeof parsed.token !== "string" || typeof parsed.email !== "string") return null
    if (typeof parsed.fetchedAt !== "number") return null
    return parsed as Cache
  }

  async function write(cache: Cache): Promise<void> {
    if (!dataPath) return
    const filepath = path.join(dataPath, CACHE_FILE)
    // The cache stores the user's email and a token verifier, so keep it
    // readable only by the owner, including when replacing an existing file.
    // Write to a temp file and rename so concurrent invocations or a mid-write
    // kill cannot leave a truncated cache behind (POSIX rename is atomic).
    const tmp = `${filepath}.${process.pid}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(cache), { mode: 0o600 })
      await chmod(tmp, 0o600)
      await rename(tmp, filepath)
    } catch (err) {
      await rm(tmp, { force: true }).catch((rmErr) => {
        if (process.env.KILO_PRINT_LOGS) console.warn("telemetry profile cache temp cleanup failed", rmErr)
      })
      if (process.env.KILO_PRINT_LOGS) console.warn("telemetry profile cache write failed", err)
    }
  }

  async function refresh(token: string, tokenHash: string): Promise<void> {
    const profile = await fetchProfile(token).catch(() => null)
    if (profile?.email) await write({ token: tokenHash, email: profile.email, fetchedAt: Date.now() })
  }

  export async function updateFromKiloAuth(token: string | null, accountId?: string): Promise<void> {
    organizationId = accountId || null

    if (!token) {
      userId = null
      return
    }

    const tokenHash = digest(token)
    const cached = await read()
    if (cached && cached.token === tokenHash) {
      userId = cached.email
      if (Date.now() - cached.fetchedAt > CACHE_TTL) {
        refresh(token, tokenHash).catch((err) => {
          if (process.env.KILO_PRINT_LOGS) console.warn("telemetry profile refresh failed", err)
        })
      }
      return
    }

    const profile = await fetchProfile(token).catch(() => null)
    userId = profile?.email || null
    if (profile?.email) await write({ token: tokenHash, email: profile.email, fetchedAt: Date.now() })
  }

  export function reset() {
    userId = null
    organizationId = null
  }
}
