import { join, resolve } from "node:path"
import {
  CleanupResult,
  DriverRequest,
  DriverResult,
  EvidenceReport,
  FixtureDescriptor,
  ProviderCleanupRequest,
  ProviderPrepareRequest,
  ProviderPrepareResult,
  SCHEMA_VERSION,
  StateDirs,
  type Assertion,
  type Resource,
  type ScenarioManifest,
} from "./schema"
import { ManifestError, validateManifest } from "./scenarios"
import { OriginError, assertLoopbackOrigins, driverEnv, providerEnv } from "./env"
import { EvidenceError, parseDriverResult, validateEvidence } from "./evidence"
import { GitError, createProject, type Project } from "./git"
import { ProtocolError, claimDir, DirExistsError, ensureDir, exists, readJsonAs, remove, writeJson } from "./protocol"
import { runChild } from "./process"
import { SecretFieldError } from "./redact"

export type ProviderConfig = {
  id: string
  command: string[]
  cwd?: string
  timeoutMs?: number
}

export type DriverConfig = {
  id: string
  command: string[]
  cwd?: string
}

export type RunOptions = {
  manifest: ScenarioManifest
  provider: ProviderConfig
  driver: DriverConfig
  artifactsDir: string
  runId?: string
  signal?: AbortSignal
  env?: Record<string, string>
  provenance?: {
    kiloCommit?: string | null
    cloudCommit?: string | null
  }
  timeouts?: {
    provider?: number
    driver?: number
  }
}

export type FailureCode =
  | "config"
  | "provider_failed"
  | "provider_timeout"
  | "provider_result"
  | "origin"
  | "project"
  | "driver_crash"
  | "driver_timeout"
  | "driver_result"
  | "driver_failed"
  | "capability"
  | "evidence"
  | "cleanup_failed"
  | "cancelled"

export class RunError extends Error {
  evidencePath?: string

  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message)
    this.name = "RunError"
  }
}

class Cancelled extends Error {}

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const EMPTY_ARTIFACTS = { logs: [], screenshots: [], snapshots: [] }

type Options = {
  manifest: ScenarioManifest
  runId: string
  runDir: string
  projectDir: string
  descriptorPath: string
  state: StateDirs
  provider: ProviderConfig
  driver: DriverConfig
  env?: Record<string, string>
  provenance: { kiloCommit?: string | null; cloudCommit?: string | null }
  signal?: AbortSignal
  providerTimeout: number
  driverTimeout: number
}

function config(message: string) {
  return new RunError("config", message)
}

function failure(stage: "provider" | "project" | "driver", error: unknown): RunError {
  if (error instanceof RunError) return error
  if (error instanceof Cancelled) return new RunError("cancelled", "run cancelled")
  if (error instanceof OriginError) return new RunError("origin", "fixture descriptor contains a non-loopback origin")
  if (error instanceof EvidenceError) {
    if (error.code === "capability") return new RunError("capability", "IDE driver is missing required capabilities")
    return new RunError("driver_result", "IDE driver result does not match the scenario")
  }
  if (error instanceof ProtocolError) {
    return new RunError(
      stage === "provider" ? "provider_result" : "driver_result",
      "subprocess result is not a valid protocol document",
    )
  }
  if (error instanceof GitError) return new RunError("project", "deterministic git fixture could not be created")
  return new RunError(
    stage === "provider" ? "provider_result" : stage === "project" ? "project" : "driver_result",
    "subprocess failed to produce a usable result",
  )
}

async function prepare(options: Options): Promise<FixtureDescriptor> {
  if (options.signal?.aborted) throw new Cancelled()
  const requestPath = join(options.runDir, "provider-prepare-request.json")
  const resultPath = join(options.runDir, "provider-prepare-result.json")
  const request = ProviderPrepareRequest.parse({
    schemaVersion: SCHEMA_VERSION,
    operation: "prepare",
    runId: options.runId,
    lane: options.manifest.lane,
    fakeLlmScope: `kilo-e2e-${options.runId}`,
    descriptorPath: options.descriptorPath,
    projectDir: options.projectDir,
    state: options.state,
  })
  await writeJson(requestPath, request)
  const exit = await runChild({
    command: options.provider.command,
    cwd: options.provider.cwd,
    requestPath,
    resultPath,
    env: providerEnv({ KILO_E2E_RUN_ID: options.runId }),
    timeoutMs: options.providerTimeout,
    signal: options.signal,
  })
  if (exit.cancelled) throw new Cancelled()
  if (exit.timedOut) throw new RunError("provider_timeout", "fixture provider timed out")
  if (exit.code !== 0) throw new RunError("provider_failed", `fixture provider exited with code ${exit.code}`)

  const result = await readJsonAs(resultPath, ProviderPrepareResult)
  if (result.runId !== options.runId) throw new RunError("provider_result", "fixture provider run id does not match")
  if (result.descriptorPath !== options.descriptorPath)
    throw new RunError("provider_result", "fixture provider returned an unexpected descriptor path")
  if (!(await exists(options.descriptorPath)))
    throw new RunError("provider_result", "fixture provider did not write a descriptor")

  const descriptor = await readJsonAs(options.descriptorPath, FixtureDescriptor)
  if (descriptor.runId !== options.runId)
    throw new RunError("provider_result", "fixture descriptor run id does not match")
  if (descriptor.lane !== options.manifest.lane)
    throw new RunError("provider_result", "fixture descriptor lane does not match")
  assertLoopbackOrigins(descriptor.origins)
  return descriptor
}

async function drive(
  options: Options,
  descriptor: FixtureDescriptor,
  project: Project,
): Promise<{ result: DriverResult; capabilities: boolean }> {
  if (options.signal?.aborted) throw new Cancelled()
  const requestPath = join(options.runDir, "driver-request.json")
  const resultPath = join(options.runDir, "driver-result.json")
  const artifactsDir = join(options.runDir, "artifacts")
  const request = DriverRequest.parse({
    schemaVersion: SCHEMA_VERSION,
    runId: options.runId,
    runDir: options.runDir,
    descriptorPath: options.descriptorPath,
    artifactsDir,
    scenario: options.manifest,
    project,
  })
  await writeJson(requestPath, request)
  const exit = await runChild({
    command: options.driver.command,
    cwd: options.driver.cwd,
    requestPath,
    resultPath,
    env: driverEnv(descriptor, { ...options.env, KILO_E2E_DRIVER_ID: options.driver.id }),
    timeoutMs: options.driverTimeout,
    signal: options.signal,
  })
  if (exit.cancelled) throw new Cancelled()
  if (exit.timedOut) throw new RunError("driver_timeout", "IDE driver timed out")
  if (exit.code !== 0) throw new RunError("driver_crash", `IDE driver exited with code ${exit.code}`)

  const parsed = await readJsonAs(resultPath, DriverResult)
  const result = parseDriverResult(parsed, options.manifest, options.runId)
  return { result, capabilities: true }
}

// A provider may write the descriptor and then fail prepare validation; re-read it best-effort so
// cleanup failures can still report (and a provider retry can trace) the owned resources.
async function recoverDescriptor(options: Options): Promise<FixtureDescriptor | undefined> {
  if (!(await exists(options.descriptorPath))) return undefined
  return readJsonAs(options.descriptorPath, FixtureDescriptor).then(
    (descriptor) => descriptor,
    () => undefined,
  )
}

async function cleanup(options: Options, descriptor: FixtureDescriptor | undefined): Promise<CleanupResult> {
  const requestPath = join(options.runDir, "provider-cleanup-request.json")
  const resultPath = join(options.runDir, "provider-cleanup-result.json")
  const present = await exists(options.descriptorPath)
  const request = ProviderCleanupRequest.parse({
    schemaVersion: SCHEMA_VERSION,
    operation: "cleanup",
    runId: options.runId,
    descriptorPath: options.descriptorPath,
    descriptorPresent: present,
  })
  // Leftovers are recorded in sanitized evidence so a failed cleanup can be retried or traced even
  // when the provider cannot report ownership; only resource ids are kept, never cleanup tokens.
  const owned = descriptor ?? (await recoverDescriptor(options))
  const failed = (message: string, removed: Resource[] = []): CleanupResult => {
    const done = new Set(removed.map((resource) => `${resource.kind}:${resource.id}`))
    return {
      schemaVersion: SCHEMA_VERSION,
      runId: options.runId,
      status: "failed",
      removed,
      leftovers: (owned?.cleanup.ids ?? [])
        .filter((resource) => !done.has(`${resource.kind}:${resource.id}`))
        .map((resource) => ({
          kind: resource.kind,
          id: resource.id,
          reason: message,
        })),
      error: message,
    }
  }
  try {
    await writeJson(requestPath, request)
    const exit = await runChild({
      command: options.provider.command,
      cwd: options.provider.cwd,
      requestPath,
      resultPath,
      env: providerEnv({ KILO_E2E_RUN_ID: options.runId }),
      timeoutMs: options.providerTimeout,
    })
    if (exit.timedOut) return failed("fixture provider cleanup timed out")
    if (exit.code !== 0) return failed(`fixture provider cleanup exited with code ${exit.code}`)
    const result = await readJsonAs(resultPath, CleanupResult)
    if (result.runId !== options.runId) return failed("fixture provider cleanup run id does not match")
    if (result.status === "failed" && result.leftovers.length === 0) {
      return failed(result.error?.trim() || "fixture provider cleanup did not complete", result.removed)
    }
    return result
  } catch (error) {
    if (error instanceof ProtocolError) return failed("fixture provider cleanup result is not a valid document")
    return failed("fixture provider cleanup failed")
  }
}

function assertionsFor(input: {
  driver: DriverResult | undefined
  capabilities: boolean
  cleanup: CleanupResult
  rejected: boolean
}): Assertion[] {
  const list: Assertion[] = [...(input.driver?.assertions ?? [])]
  if (input.driver) list.push({ name: "driver.result", status: "passed" })
  if (input.driver) list.push({ name: "driver.capabilities", status: input.capabilities ? "passed" : "failed" })
  list.push({
    name: "cleanup.complete",
    status: input.cleanup.status === "clean" ? "passed" : "failed",
  })
  if (input.rejected) list.push({ name: "evidence.schema", status: "failed" })
  else if (input.driver) list.push({ name: "evidence.schema", status: "passed" })
  return list
}

function build(input: {
  options: Options
  driver: DriverResult | undefined
  cleanup: CleanupResult
  startedAt: string
  endedAt: string
  outcome: "passed" | "failed" | "cancelled"
  error: RunError | undefined
  capabilities: boolean
  rejected: boolean
}): EvidenceReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: input.options.runId,
    scenarioId: input.options.manifest.id,
    lane: input.options.manifest.lane,
    provenance: {
      kiloCommit: input.options.provenance.kiloCommit ?? null,
      cloudCommit: input.options.provenance.cloudCommit ?? null,
      ide: input.driver?.ide ?? { name: "unknown", version: "unknown" },
      clientHash: input.driver?.provenance.clientHash ?? null,
      cliHash: input.driver?.provenance.cliHash ?? null,
      fixtureSchemaVersion: SCHEMA_VERSION,
    },
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    outcome: input.outcome,
    assertions: assertionsFor(input),
    lastState: input.driver?.lastState ?? {},
    artifacts: input.driver?.artifacts ?? EMPTY_ARTIFACTS,
    cleanup: input.cleanup,
    ...(input.error ? { failure: { code: input.error.code, message: input.error.message } } : {}),
  }
}

export async function run(options: RunOptions): Promise<EvidenceReport> {
  const manifest = (() => {
    try {
      return validateManifest(options.manifest)
    } catch (caught) {
      if (caught instanceof ManifestError) throw config("scenario manifest is invalid")
      throw caught
    }
  })()
  const runId = options.runId ?? crypto.randomUUID()
  if (!RUN_ID.test(runId) || runId.includes("..")) throw config("run id must be a safe single path segment")
  if (options.provider.command.length === 0) throw config("fixture provider command is empty")
  if (options.driver.command.length === 0) throw config("IDE driver command is empty")

  const runDir = resolve(options.artifactsDir, runId)
  await ensureDir(options.artifactsDir)
  try {
    await claimDir(runDir)
  } catch (error) {
    if (error instanceof DirExistsError) throw config("run directory already exists; choose a new run id")
    throw error
  }
  const artifactsDir = join(runDir, "artifacts")
  const projectDir = join(runDir, "project")
  const descriptorPath = join(runDir, "descriptor.json")
  const state: StateDirs = {
    data: join(runDir, "state", "data"),
    config: join(runDir, "state", "config"),
    state: join(runDir, "state", "state"),
    cache: join(runDir, "state", "cache"),
  }
  await ensureDir(artifactsDir)
  for (const dir of Object.values(state)) await ensureDir(dir)

  const prepared: Options = {
    manifest,
    runId,
    runDir,
    projectDir,
    descriptorPath,
    state,
    provider: options.provider,
    driver: options.driver,
    env: options.env,
    provenance: options.provenance ?? {},
    signal: options.signal,
    providerTimeout: options.timeouts?.provider ?? options.provider.timeoutMs ?? 30_000,
    driverTimeout: options.timeouts?.driver ?? manifest.timeoutMs,
  }

  const startedAt = new Date().toISOString()
  let descriptor: FixtureDescriptor | undefined
  let driver: DriverResult | undefined
  let error: RunError | undefined
  let cancelled = false
  let capabilities = false
  let stage: "provider" | "project" | "driver" = "provider"

  try {
    descriptor = await prepare(prepared)
    stage = "project"
    const project = await createProject(projectDir)
    stage = "driver"
    const driven = await drive(prepared, descriptor, project)
    driver = driven.result
    capabilities = driven.capabilities
    if (driver.outcome !== "passed") error = new RunError("driver_failed", "IDE driver reported a failed scenario")
  } catch (caught) {
    if (caught instanceof Cancelled) cancelled = true
    else error = failure(stage, caught)
  }

  const cleanupResult = await cleanup(prepared, descriptor)
  // Keep the descriptor when cleanup cannot prove it removed the owned resources, so the cleanup
  // token and resource ids remain traceable; the report still records the owned ids in `leftovers`.
  if (cleanupResult.status === "clean") await remove(descriptorPath)
  if (cleanupResult.status === "failed" && !error) {
    error = new RunError("cleanup_failed", "fixture cleanup did not complete")
  }

  const endedAt = new Date().toISOString()
  const outcome = cancelled ? "cancelled" : error ? "failed" : "passed"
  let evidence = build({
    options: prepared,
    driver,
    cleanup: cleanupResult,
    startedAt,
    endedAt,
    outcome,
    error,
    capabilities,
    rejected: false,
  })

  const evidencePath = join(runDir, "evidence.json")
  try {
    evidence = validateEvidence(evidence, runDir)
  } catch (caught) {
    const reason =
      caught instanceof EvidenceError || caught instanceof SecretFieldError
        ? "evidence was rejected by schema or secret validation"
        : "evidence could not be validated"
    if (!error) error = new RunError("evidence", reason)
    evidence = build({
      options: prepared,
      driver: undefined,
      cleanup: {
        schemaVersion: SCHEMA_VERSION,
        runId,
        status: cleanupResult.status,
        removed: [],
        leftovers: [],
        ...(cleanupResult.status === "failed" ? { error: "fixture cleanup did not complete" } : {}),
      },
      startedAt,
      endedAt,
      outcome: cancelled ? "cancelled" : "failed",
      error,
      capabilities: false,
      rejected: true,
    })
    evidence = validateEvidence(evidence, runDir)
  }

  await writeJson(evidencePath, evidence)

  if (cancelled) {
    const cancel = new RunError("cancelled", "run cancelled")
    cancel.evidencePath = evidencePath
    throw cancel
  }
  if (error) {
    error.evidencePath = evidencePath
    throw error
  }
  return evidence
}
