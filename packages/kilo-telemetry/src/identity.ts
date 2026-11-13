export * as Identity from "./identity.js"

import path from "node:path"
import { createHash } from "node:crypto"
import { chmod, rename, rm, writeFile } from "node:fs/promises"
import { KiloMachine, KiloProfile, KiloServer } from "@kilocode/gateway-core"
import { Effect } from "effect"

// The email resolved from the auth token is cached so a start does not block on a profile request. Keyed by token
// hash; refreshed when the token changes. An entry older than a week is still used and refreshed in the background.
const CACHE_FILE = "telemetry-profile.json"
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

interface Cache {
  token: string
  email: string
  fetchedAt: number
}

const state = {
  machineId: null as string | null,
  userId: null as string | null,
  organizationId: null as string | null,
  dataPath: "",
}

/** The machine ID belongs to the data path, so a new path reads it again. */
export function setDataPath(p: string) {
  state.dataPath = p
  state.machineId = null
}

/** The anonymous machine ID shared with the Gateway headers: `KILO_MACHINE_ID`, else `<data>/telemetry-id`. */
export async function getMachineId(): Promise<string | undefined> {
  if (state.machineId) return state.machineId
  // Without a data path nothing is written, so a missing configuration never lands in the working directory.
  const id = await Effect.runPromise(KiloMachine.get(state.dataPath || undefined))
  state.machineId = id ?? null
  return id
}

export function getDistinctId(): string {
  return state.userId || state.machineId || "unknown"
}

export function getUserId(): string | null {
  return state.userId
}

export function getOrganizationId(): string | null {
  return state.organizationId
}

export function setOrganizationId(orgId: string | null) {
  state.organizationId = orgId
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

async function read(): Promise<Cache | null> {
  if (!state.dataPath) return null
  const file = Bun.file(path.join(state.dataPath, CACHE_FILE))
  if (!(await file.exists())) return null
  const parsed: unknown = await file.json().catch(() => null)
  if (!parsed || typeof parsed !== "object") return null
  if (!("token" in parsed) || typeof parsed.token !== "string") return null
  if (!("email" in parsed) || typeof parsed.email !== "string") return null
  if (!("fetchedAt" in parsed) || typeof parsed.fetchedAt !== "number") return null
  return { token: parsed.token, email: parsed.email, fetchedAt: parsed.fetchedAt }
}

async function write(cache: Cache): Promise<void> {
  if (!state.dataPath) return
  const filepath = path.join(state.dataPath, CACHE_FILE)
  // The cache stores the user's email and a token verifier, so keep it readable only by the owner, also when it
  // replaces an existing file. A temp file and a rename keep concurrent writers and a killed write from leaving a
  // truncated cache behind.
  const tmp = `${filepath}.${process.pid}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(cache), { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, filepath)
  } catch (err) {
    await rm(tmp, { force: true }).catch((rmErr: unknown) => {
      if (process.env.KILO_PRINT_LOGS) console.warn("telemetry profile cache temp cleanup failed", rmErr)
    })
    if (process.env.KILO_PRINT_LOGS) console.warn("telemetry profile cache write failed", err)
  }
}

// Never rejects: an unreachable API, a rejected token and an invalid API URL all leave the user anonymous.
function fetchEmail(token: string, server: string | undefined) {
  return Effect.runPromise(
    Effect.suspend(() => KiloProfile.get(server ?? KiloServer.fromEnv(), token)).pipe(
      Effect.map((profile) => profile.email || null),
      Effect.catchCause(() => Effect.succeed(null)),
    ),
  )
}

async function refresh(token: string, tokenHash: string, server: string | undefined): Promise<void> {
  const email = await fetchEmail(token, server)
  if (email) await write({ token: tokenHash, email, fetchedAt: Date.now() })
}

/** Resolve the account email of a Kilo token. `server` is the Kilo API of the account; it defaults to `KILO_API_URL`. */
export async function updateFromKiloAuth(token: string | null, accountId?: string | null, server?: string): Promise<void> {
  state.organizationId = accountId || null

  if (!token) {
    state.userId = null
    return
  }

  const tokenHash = digest(token)
  const cached = await read()
  if (cached && cached.token === tokenHash) {
    state.userId = cached.email
    if (Date.now() - cached.fetchedAt > CACHE_TTL) {
      refresh(token, tokenHash, server).catch((err: unknown) => {
        if (process.env.KILO_PRINT_LOGS) console.warn("telemetry profile refresh failed", err)
      })
    }
    return
  }

  const email = await fetchEmail(token, server)
  state.userId = email
  if (email) await write({ token: tokenHash, email, fetchedAt: Date.now() })
}

export function reset() {
  state.userId = null
  state.organizationId = null
}
