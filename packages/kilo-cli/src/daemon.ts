import type { GatewayOptions } from "@kilocode/gateway"
import { Service } from "@opencode-ai/client/service"
import { ServiceStatus } from "@opencode-ai/protocol/groups/health"
import { Effect, Option, Schema } from "effect"
import { randomUUID } from "node:crypto"
import { lstatSync } from "node:fs"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import manifest from "../package.json"
import { preflight, type Layout } from "./paths"
import type { TelemetryConfig } from "./telemetry"

// A managed interactive daemon is the same isolated conversation host the TUI boots in-process,
// kept alive as a detached loopback server so a client can attach, detach, and reattach to it.
//
// Discovery reuses the upstream client service contract (registration file plus authenticated
// /api/health probe) with an explicit file inside the isolated interactive state directory. The
// stable kilo/opencode service registration is never read or written, so no lifecycle operation
// here can discover, replace, or signal that server.
//
// Every lifecycle operation authenticates the recorded owner before it lets upstream act on it.
// Service.ensure terminates a registration that times out three times even though it never
// authenticated the process behind it, so an unverified record whose PID is still running is
// refused here instead of being handed to upstream recovery.

const probeTimeout = 2000

export function registration(input: Layout) {
  if (input.channel !== "interactive") throw new Error("The managed daemon requires the isolated interactive profile")
  return path.join(input.paths.state, "daemon.json")
}

/** Run the managed daemon in this process until its scope closes. */
export function serve(
  input: Layout,
  options: {
    models?: boolean
    content?: string
    gateway?: GatewayOptions
    telemetry?: TelemetryConfig
    persistedTelemetry?: boolean
    lock?: { staleMs?: number; timeoutMs?: number }
  } = {},
) {
  return Effect.gen(function* () {
    const file = registration(input)
    const { launch } = yield* Effect.promise(() => import("./interactive-server"))
    const endpoint = yield* launch(input, {
      models: options.models,
      content: options.content,
      gateway: options.gateway,
      // Off unless the caller resolved an explicit opt-in; a daemon never enables it on its own.
      telemetry: options.telemetry,
      persistedTelemetry: options.persistedTelemetry,
      // A managed daemon refuses a contended store quickly instead of waiting out a foreground TUI.
      lock: options.lock ?? { timeoutMs: 10_000 },
    })
    if (!endpoint.url) throw new Error("The managed daemon requires a bound loopback address")
    const info = {
      id: randomUUID(),
      version: manifest.version,
      url: endpoint.url,
      pid: process.pid,
      password: endpoint.auth.password,
    }
    yield* Effect.acquireRelease(
      Effect.promise(() => publish(file, info)),
      () => Effect.promise(() => withdraw(file, info)),
    )
    return { file, info, endpoint: { url: info.url, auth: endpoint.auth } }
  })
}

/** Ensure a healthy managed daemon is running and return its endpoint. */
export async function start(
  input: Layout,
  options: {
    command?: ReadonlyArray<string>
    env?: Readonly<Record<string, string>>
    onStart?: (reason: "missing" | "version-mismatch", previous?: string) => void
  } = {},
) {
  const file = resolve(input)
  const current = await owner(file)
  if (current !== undefined && !current.verified) {
    // Fail closed. Upstream recovery would eventually signal this PID on health timeouts, so an
    // unverified owner that is still running is never replaced, restarted, or signaled here.
    if (current.alive) {
      throw new Error(
        `Refusing to replace an unverified Kilo daemon registration (pid ${current.info.pid} is running); inspect ${file}`,
      )
    }
    // A demonstrably dead owner cannot be signaled at all, so dropping its record is the recovery.
    await rm(file, { force: true })
  }
  if (current?.verified && current.ready && current.compatible) return endpoint(current.info)
  // Upstream owns spawning, and replacing an authenticated incompatible or still-starting daemon.
  return Service.ensure({
    file,
    version: manifest.version,
    // Compiled distributions pass their own launcher; the source runtime runs the entry directly.
    command: options.command ?? [
      process.execPath,
      "--no-env-file",
      path.join(import.meta.dir, import.meta.path.endsWith(".ts") ? "daemon-entry.ts" : "daemon-entry.js"),
    ],
    env: options.env,
    onStart: options.onStart,
  })
}

/** Report the managed daemon's discovery state without starting or signaling anything. */
export async function status(input: Layout) {
  const file = resolve(input)
  const current = await owner(file)
  if (current === undefined) return { state: "stopped" as const, file }
  if (current.verified && current.ready && current.compatible) {
    return {
      state: "running" as const,
      file,
      endpoint: endpoint(current.info),
      pid: current.info.pid,
      version: current.info.version,
    }
  }
  return {
    state: "stale" as const,
    file,
    pid: current.info.pid,
    version: current.info.version,
    alive: current.alive,
    verified: current.verified,
  }
}

/** Stop the managed daemon after authenticating the registration it advertises. */
export async function stop(input: Layout) {
  const file = resolve(input)
  const current = await owner(file)
  if (current === undefined) return { state: "stopped" as const, file }
  // Only a registration that answers an authenticated health probe with its own PID may be
  // signaled, so stale or unowned metadata can never terminate an unrelated process.
  if (!current.verified) {
    throw new Error(
      `Refusing to stop an unverified Kilo daemon registration (pid ${current.info.pid} is ${current.alive ? "running" : "gone"}); inspect ${file}. ` +
        "Starting the daemon replaces a registration whose owner is gone.",
    )
  }
  await Service.stop({ file })
  return { state: "stopped" as const, file, pid: current.info.pid }
}

// Written by the daemon itself, so every field is required here; anything else is unowned metadata.
const Registration = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  url: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  password: Schema.String,
})

type Registration = typeof Registration.Type

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Registration))
const decodeHealth = Schema.decodeUnknownOption(ServiceStatus.Health)

// The isolated layout must be intact before any lifecycle operation reads it or spawns into it.
function resolve(input: Layout) {
  preflight(input)
  return registration(input)
}

function endpoint(info: Registration) {
  return { url: info.url, auth: { type: "basic" as const, username: "opencode", password: info.password } }
}

async function owner(file: string) {
  const info = await read(file)
  if (info === undefined) return undefined
  const health = await probe(info)
  return {
    info,
    verified: health !== undefined,
    ready: health?.ready === true,
    compatible: health?.version === manifest.version,
    alive: alive(info.pid),
  }
}

// An authenticated health response carrying the recorded PID is the only proof of ownership; a
// starting daemon answers it before it is ready, and everything else counts as unverified.
async function probe(info: Registration) {
  const response = await fetch(new URL("/api/health", info.url), {
    headers: { authorization: `Basic ${btoa(`opencode:${info.password}`)}` },
    signal: AbortSignal.timeout(probeTimeout),
  }).catch(() => undefined)
  if (response === undefined) return undefined
  const health = Option.getOrUndefined(decodeHealth(await response.json().catch(() => undefined)))
  if (health === undefined || health.pid !== info.pid) return undefined
  return { version: health.version, ready: response.ok }
}

// Unreadable, shared, or foreign metadata is an error rather than an absent daemon: it must never
// silently become a reason to spawn into, or signal through, storage this profile does not own.
async function read(file: string) {
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (!stat) return undefined
  if (stat.isSymbolicLink()) throw new Error(`Refusing a symlinked daemon registration: ${file}`)
  if (!stat.isFile() || stat.nlink !== 1)
    throw new Error(`Refusing a shared or non-regular daemon registration: ${file}`)
  if ((stat.mode & 0o077) !== 0)
    throw new Error(`Daemon registration must be private to its owner (mode 0600): ${file}`)
  const info = Option.getOrUndefined(decode(await readFile(file, "utf8")))
  if (info === undefined) throw new Error(`Refusing an unreadable daemon registration: ${file}`)
  if (!loopback(info.url)) throw new Error(`Refusing a daemon registration that is not a loopback endpoint: ${file}`)
  if (!/^[a-f0-9]{64}$/.test(info.password))
    throw new Error(`Refusing a daemon registration without an owned server password: ${file}`)
  return info
}

function loopback(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (url.protocol !== "http:" || url.port === "" || url.username || url.password) return false
  return url.hostname === "127.0.0.1" || url.hostname === "[::1]"
}

async function publish(file: string, info: Registration) {
  const temporary = `${file}.${info.id}.tmp`
  await writeFile(temporary, JSON.stringify(info), { mode: 0o600, flag: "wx" })
  await rename(temporary, file).catch(async (cause: unknown) => {
    await rm(temporary, { force: true })
    throw cause
  })
}

async function withdraw(file: string, info: Registration) {
  // Shutdown must not fail on metadata another owner replaced or corrupted.
  const current = await read(file).catch(() => undefined)
  if (current === undefined || current.id !== info.id || current.pid !== info.pid) return
  await rm(file, { force: true })
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
