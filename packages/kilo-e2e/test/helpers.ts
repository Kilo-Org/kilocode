import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { RunError, type RunOptions } from "../src/coordinator"
import { validateEvidence } from "../src/evidence"
import { SCHEMA_VERSION, type EvidenceReport, type FixtureDescriptor } from "../src/schema"
import { manifest } from "../src/scenarios"

export const root = resolve(import.meta.dir, "..")

export function command(name: string) {
  return [process.execPath, join(root, "fixtures", name)]
}

export function options(dir: string, overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    manifest: manifest("session.open", "local"),
    provider: { id: "fake-provider", command: command("provider.ts") },
    driver: { id: "fake-driver", command: command("driver.ts") },
    artifactsDir: dir,
    runId: "run",
    provenance: { kiloCommit: "1".repeat(40), cloudCommit: "2".repeat(40) },
    timeouts: { provider: 15_000, driver: 15_000 },
    ...overrides,
  }
}

export function descriptor(overrides: Partial<FixtureDescriptor> = {}): FixtureDescriptor {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run",
    lane: "local",
    createdAt: new Date().toISOString(),
    fakeLlmScope: "scope",
    origins: {
      web: "http://127.0.0.1:43100",
      cloudAgent: "http://127.0.0.1:43101",
      sessionIngest: "http://127.0.0.1:43102",
      events: "ws://127.0.0.1:43103",
      gateway: "http://127.0.0.1:43104",
      fakeLlm: "http://127.0.0.1:43105",
    },
    credentials: { apiKey: "fake-key", orgId: "org-fake" },
    project: {
      fixture: "deterministic-git",
      gitUrl: "file:///tmp/project",
      branch: "main",
      model: "kilo/fake-deterministic",
      seed: "kilo-e2e",
    },
    resources: {},
    cleanup: { token: "cleanup-token", ids: [] },
    state: {
      data: "/tmp/data",
      config: "/tmp/config",
      state: "/tmp/state",
      cache: "/tmp/cache",
    },
    ...overrides,
  }
}

export async function sandbox<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "kilo-e2e-"))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Abort once the slow driver fixtures report they are running (they write driver-started after
// installing their signal handlers), so cancellation always reaches a live child after the provider
// prepared its resources, instead of racing a fixed timer on slow runners. The watchdog only
// bounds a stuck run.
export function abortWhenDriverStarts(dir: string, controller: AbortController, runId = "run") {
  const file = Bun.file(join(dir, runId, "driver-started"))
  const state = { stopped: false }
  const watchdog = setTimeout(() => controller.abort(), 10_000)
  const poll = setInterval(async () => {
    if (state.stopped || !(await file.exists()) || state.stopped) return
    state.stopped = true
    clearInterval(poll)
    clearTimeout(watchdog)
    controller.abort()
  }, 10)
  return () => {
    state.stopped = true
    clearInterval(poll)
    clearTimeout(watchdog)
  }
}

export async function readEvidence(dir: string, runId = "run"): Promise<EvidenceReport> {
  const runDir = join(dir, runId)
  const raw = JSON.parse(await Bun.file(join(runDir, "evidence.json")).text())
  return validateEvidence(raw, runDir)
}

export async function rejected(promise: Promise<unknown>): Promise<RunError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof RunError) return error
    throw error
  }
  throw new Error("expected the run to fail")
}
