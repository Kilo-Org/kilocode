import { createKiloClient, type Event, type GlobalEvent, type KiloClient, type Session } from "@kilocode/sdk/v2/client"
import {
  getErrorMessage,
  mapSSEEventToWebviewMessage,
  MessageConfirmation,
  sessionToWebview,
} from "../../kilo-provider-utils"
import { slimInfo, slimPart, slimParts } from "../../kilo-provider/slim-metadata"
import { sessionStatusToWebview } from "../../session-status"
import { SNAPSHOT_INITIALIZATION } from "../constants"
import { SSEHeartbeat } from "../../services/sse-heartbeat"
import { parseCloudCommand } from "./command"
import { CloudAgentDisconnectedError, CloudAgentSignedOutError, isCloudAgentUnauthorized } from "./errors"
import { resolveCloudAgentProfile } from "./profile"
import { listCloudAgentSessions } from "./list"
import { CloudRepositoryUnavailableError, resolveCloudRepository } from "./repository"
import { CloudAgentStartError, startCloudAgent, type CloudAgentStartInput } from "./start"
import { parseCloudMessageAcceptance, parseCloudMessageFailure } from "./message"
import { parseCloudStatus } from "./status"
import {
  equalCloudSummary,
  mergeCloudSummaries,
  pickCloudSummary,
  replaceCloudSummary,
  toCloudSummary,
  type CloudSummarySource,
  type CloudSummaryVersion,
} from "../../shared/cloud-session-summary"
import { CloudAgentStaleTokenError, CloudAgentTokenManager } from "./token"
import type { CloudAgentListState, CloudAgentSessionSummary, CloudAgentToken } from "./types"

const RECONNECT_MS = 250
const MAX_RECONNECT_MS = 5_000
const MAX_METADATA = 100
const MAX_BUFFER = 1_000
const HEARTBEAT_MS = 15_000
const INTERACTIVE = new Set(["permission.asked", "question.asked", "suggestion.shown"])
const UNSUPPORTED = "Cloud Agent session stopped because interactive requests are not supported in VS Code yet."
const AUTH_ERROR = "Cloud Agent authentication could not be refreshed. Retry after signing in again."
const CREATE_CONTEXT_ERROR =
  "Cloud Agent creation context is unavailable. Retry after reconnecting or signing in again."
const CREATE_INDETERMINATE =
  "Cloud Agent session creation may already have succeeded. Check Cloud Agents before starting another session."
const STARTUP_PENDING = Symbol("startup-pending")
const SNAPSHOT_FAILED = Symbol("snapshot-failed")

type Message = Record<string, unknown> & { type?: string; sessionID?: string; sessionId?: string }
type Repository = Awaited<ReturnType<typeof resolveCloudRepository>>
type CreateOperation = { epoch: number; generation: number; invalidated: boolean }
type Metadata = { version: CloudSummaryVersion; output: unknown; posted: boolean }
type Snapshot = {
  sessionID: string
  epoch: number
  generation: number
  loadEpoch: number
  request: number
  event: number
  status: unknown
  detail?: ReturnType<typeof sessionToWebview>
  transcript: unknown
}

type Options = {
  getLocalClient: () => KiloClient | null
  getRoot: () => string | undefined
  remoteUrl: (cwd: string, remote?: string) => Promise<string | undefined>
  post: (message: unknown) => void
  log: (...args: unknown[]) => void
  createClient?: typeof createKiloClient
  listSessions?: typeof listCloudAgentSessions
  startAgent?: typeof startCloudAgent
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
  heartbeat?: number
  confirmation?: number
}

export function cloudDirectory(sessionID: string): string {
  return `/cloud-agent/sessions/${sessionID}`
}

export class CloudAgentController {
  private readonly token: CloudAgentTokenManager
  private readonly create: typeof createKiloClient
  private readonly listSessions: typeof listCloudAgentSessions
  private readonly startAgent: typeof startCloudAgent
  private readonly confirmations = new MessageConfirmation()
  private readonly confirmation: number
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>
  private readonly admitted = new Set<string>()
  private readonly openIDs = new Set<string>()
  private readonly tombstones = new Set<string>()
  private readonly loads = new Map<string, number>()
  private readonly pendingLoads = new Set<string>()
  private readonly stops = new Set<string>()
  private readonly startups = new Set<string>()
  private readonly observed = new Map<string, CloudSummaryVersion>()
  private readonly events = new Map<string, number>()
  private readonly metadata = new Map<string, Metadata>()
  private remote: { client: KiloClient; token: CloudAgentToken } | null = null
  private abort: AbortController | null = null
  private sessions: CloudAgentSessionSummary[] = []
  private scope: string | null = null
  private scopeRoot: string | undefined | null = null
  private resolving = false
  private admitting = false
  private attached = false
  private disposed = false
  private wantedList = false
  private wantedContext = false
  private pausedAuth = false
  private suspended = false
  private reconcile = false
  private operation: CreateOperation | null = null
  private remote401 = 0
  private epoch = 0
  private generation = 0
  private contextSeq = 0
  private listEpoch = 0
  private loadEpoch = 0

  constructor(private readonly opts: Options) {
    this.token = new CloudAgentTokenManager(opts.getLocalClient)
    this.create = opts.createClient ?? createKiloClient
    this.listSessions = opts.listSessions ?? listCloudAgentSessions
    this.startAgent = opts.startAgent ?? startCloudAgent
    this.confirmation = opts.confirmation ?? 1_500
    this.wait = opts.wait ?? delay
  }

  attach(): void {
    if (this.disposed || this.attached) return
    this.attached = true
    this.suspended = false
    this.epoch++
  }

  detach(): void {
    this.attached = false
    this.suspended = true
    if (this.operation) this.operation.invalidated = true
    this.epoch++
    this.contextSeq++
    this.listEpoch++
    this.loadEpoch++
    this.stopStream()
    this.admitted.clear()
    this.openIDs.clear()
    this.tombstones.clear()
    this.loads.clear()
    this.pendingLoads.clear()
    this.stops.clear()
    this.startups.clear()
    this.observed.clear()
    this.events.clear()
    this.metadata.clear()
    this.sessions = []
    this.scope = null
    this.scopeRoot = null
    this.resolving = false
    this.admitting = false
    this.wantedList = false
    this.wantedContext = false
    this.pausedAuth = false
    this.remote401 = 0
    this.reset()
  }

  dispose(): void {
    this.detach()
    this.disposed = true
  }

  requestList(): void {
    if (!this.active()) return
    this.wantedList = true
    if (this.pausedAuth) {
      this.postList({ status: "error", sessions: [], error: AUTH_ERROR })
      return
    }
    this.discover()
  }

  retryList(): void {
    if (!this.active()) return
    if (this.pausedAuth || this.suspended) {
      this.pausedAuth = false
      this.suspended = false
      this.remote401 = 0
      this.reset()
    } else {
      this.token.retry()
    }
    this.requestList()
    this.syncStream()
  }

  recover(): void {
    if (!this.active() || this.pausedAuth) return
    this.suspended = false
    if (this.wantedList) this.discover()
    if (this.wantedContext) void this.requestCreateContext()
    this.syncStream()
  }

  localDisconnected(): void {
    if (!this.active()) return
    this.invalidateCreate()
    this.contextSeq++
    if (this.wantedContext) this.postContextUnavailable()
    this.suspended = true
    this.lock()
  }

  authChanged(): void {
    if (!this.active()) return
    this.invalidateCreate()
    this.contextSeq++
    this.pausedAuth = false
    this.suspended = false
    this.remote401 = 0
    this.lock()
    if (this.wantedList) this.discover()
    if (this.wantedContext) void this.requestCreateContext()
    this.syncStream()
  }

  open(sessionID: string): void {
    if (!sessionID || !this.active()) return
    this.tombstones.delete(sessionID)
    this.openIDs.add(sessionID)
    this.syncStream()
  }

  close(sessionID: string): void {
    this.openIDs.delete(sessionID)
    this.tombstones.delete(sessionID)
    this.startups.delete(sessionID)
    this.loads.delete(sessionID)
    this.pendingLoads.delete(sessionID)
    this.events.delete(sessionID)
    if (!this.openIDs.size) this.reconcile = false
    this.syncStream()
  }

  owns(sessionID?: string): boolean {
    return Boolean(sessionID && (this.openIDs.has(sessionID) || this.tombstones.has(sessionID)))
  }

  handle(message: Message): boolean {
    if (message.type === "agentManager.requestCloudCreateContext") {
      void this.requestCreateContext()
      return true
    }
    if (message.type === "agentManager.createCloudSession") {
      void this.createSession(message)
      return true
    }
    if (message.type === "agentManager.requestCloudSessions") {
      this.requestList()
      return true
    }
    if (message.type === "agentManager.retryCloudSessions") {
      this.retryList()
      return true
    }
    if (message.type === "agentManager.openCloudSession") {
      if (typeof message.sessionId === "string" && this.admitted.has(message.sessionId)) this.open(message.sessionId)
      return true
    }
    if (message.type === "agentManager.closeCloudSession") {
      if (typeof message.sessionId === "string") this.close(message.sessionId)
      return true
    }

    const sessionID = this.sessionID(message)
    if (!sessionID || !this.owns(sessionID)) return false
    if (message.type === "requestCommands") {
      void this.commands(sessionID, typeof message.requestID === "number" ? message.requestID : undefined)
      return true
    }
    if (message.type === "loadMessages") {
      if (this.reconcile) this.pendingLoads.add(sessionID)
      else void this.load(sessionID)
      return true
    }
    if (message.type === "sendMessage") {
      void this.send(message)
      return true
    }
    if (message.type === "abort") {
      void this.stop(sessionID)
      return true
    }
    if (message.type === "sendCommand") {
      void this.command(message)
      return true
    }
    this.opts.post({
      type: "error",
      sessionID,
      message: `Cloud Agent sessions do not support ${message.type ?? "this action"}`,
    })
    return true
  }

  private active(epoch = this.epoch): boolean {
    return this.attached && !this.disposed && this.epoch === epoch
  }

  private sessionID(message: Message): string | undefined {
    return typeof message.sessionID === "string"
      ? message.sessionID
      : typeof message.sessionId === "string"
        ? message.sessionId
        : undefined
  }

  private async requestCreateContext(): Promise<void> {
    if (!this.active()) return
    this.wantedContext = true
    const epoch = this.epoch
    const generation = this.generation
    const seq = ++this.contextSeq
    if (this.pausedAuth) {
      this.opts.post({ type: "agentManager.cloudCreateContext", status: "signed-out" })
      return
    }
    try {
      const repository = await resolveCloudRepository(this.opts.getRoot(), this.opts.remoteUrl)
      const profile = await resolveCloudAgentProfile(this.opts.getLocalClient()).catch((err) => {
        if (isCloudAgentUnauthorized(err)) throw new CloudAgentSignedOutError("Cloud Agent profile fetch failed")
        throw err
      })
      if (!this.currentContext(epoch, generation, seq)) return
      this.opts.post({
        type: "agentManager.cloudCreateContext",
        status: "ready",
        repository: repository.label,
        account: profile.label,
      })
    } catch (err) {
      if (!this.currentContext(epoch, generation, seq)) return
      if (err instanceof CloudAgentSignedOutError) {
        this.opts.post({ type: "agentManager.cloudCreateContext", status: "signed-out" })
        return
      }
      this.postContextUnavailable()
    }
  }

  private postContextUnavailable(): void {
    this.opts.post({ type: "agentManager.cloudCreateContext", status: "unavailable", error: CREATE_CONTEXT_ERROR })
  }

  private async createSession(input: Message): Promise<void> {
    if (this.operation) {
      this.rejectOverlap(this.operation)
      return
    }
    if (this.pausedAuth) {
      this.failCreate("rejected", AUTH_ERROR)
      return
    }
    const fields = createFields(input)
    if (!fields) {
      this.failCreate("rejected", "Cloud Agent creation requires a prompt, mode, and model")
      return
    }

    const op = { epoch: this.epoch, generation: this.generation, invalidated: false }
    this.operation = op
    try {
      const repository = await resolveCloudRepository(this.opts.getRoot(), this.opts.remoteUrl)
      const profile = await resolveCloudAgentProfile(this.opts.getLocalClient()).catch((err) => {
        if (isCloudAgentUnauthorized(err)) throw new CloudAgentSignedOutError("Cloud Agent profile fetch failed")
        throw err
      })
      const options: CloudAgentStartInput["options"] = { createdOnPlatform: "agent-manager" }
      if (profile.organizationId) options.kilocodeOrganizationId = profile.organizationId
      const result = await this.startCloudSession(
        {
          message: { prompt: fields.prompt },
          agent: { mode: fields.mode, model: fields.model },
          repository: repository.repository,
          options,
        },
        op.epoch,
        op.generation,
      )
      if (!this.currentCreate(op)) return
      this.openStartup(result.kiloSessionId)
      if (!this.currentCreate(op)) return
      const now = new Date().toISOString()
      this.opts.post({
        type: "agentManager.cloudSessionCreated",
        session: { id: result.kiloSessionId, title: "Cloud Agent session", createdAt: now, updatedAt: now },
      })
      if (this.wantedList) this.discover()
    } catch (err) {
      if (err instanceof AuthRejectedError && this.currentCreate(op, false)) {
        this.failCreate("rejected", AUTH_ERROR)
        return
      }
      if (!this.currentCreate(op) || this.stale(op.epoch, op.generation, err)) return
      if (err instanceof CloudAgentSignedOutError) {
        this.failCreate("rejected", "Sign in to create a Cloud Agent session")
        return
      }
      const kind = err instanceof CloudAgentStartError ? err.kind : "rejected"
      this.failCreate(kind === "indeterminate" ? "indeterminate" : "rejected", createError(err))
      if (kind === "indeterminate" && this.wantedList) this.discover()
    } finally {
      if (this.operation === op) this.operation = null
    }
  }

  private async startCloudSession(input: CloudAgentStartInput, epoch: number, generation: number) {
    for (const attempt of [0, 1]) {
      const token = await this.getToken(epoch, generation)
      try {
        const result = await this.startAgent({ url: token.cloudAgentUrl, token: token.token, input })
        if (!this.active(epoch) || !this.currentGeneration(generation)) throw new StaleError()
        return result
      } catch (err) {
        if (!this.active(epoch) || !this.currentGeneration(generation) || err instanceof StaleError)
          throw new StaleError()
        if (!(err instanceof CloudAgentStartError) || err.kind !== "unauthorized") throw err
        if (attempt === 1) {
          this.pause(generation, false)
          throw new AuthRejectedError(AUTH_ERROR)
        }
        this.reset()
      }
    }
    throw new StaleError()
  }

  private openStartup(sessionID: string): void {
    this.admitted.add(sessionID)
    this.startups.add(sessionID)
    this.reconcile = true
    this.stopStream()
    this.open(sessionID)
  }

  private failCreate(kind: "rejected" | "indeterminate", error: string): void {
    this.opts.post({ type: "agentManager.cloudSessionCreateFailed", kind, error })
  }

  private rejectOverlap(op: CreateOperation): void {
    if (op.invalidated || !this.active(op.epoch)) this.failCreate("indeterminate", CREATE_INDETERMINATE)
  }

  private invalidateCreate(): void {
    if (!this.operation || this.operation.invalidated) return
    this.operation.invalidated = true
    this.failCreate("indeterminate", CREATE_INDETERMINATE)
  }

  private currentCreate(op: CreateOperation, generation = true): boolean {
    return (
      this.operation === op &&
      !op.invalidated &&
      this.active(op.epoch) &&
      (!generation || this.currentGeneration(op.generation))
    )
  }

  private currentContext(epoch: number, generation: number, seq: number): boolean {
    return this.active(epoch) && this.currentGeneration(generation) && this.contextSeq === seq
  }

  private discover(): void {
    if (!this.active()) return
    const epoch = this.epoch
    const generation = this.generation
    const request = ++this.listEpoch
    this.resolving = true
    this.admitting = true
    this.metadata.clear()
    this.postList({ status: "loading", sessions: [] })
    this.syncStream()
    void this.list(epoch, generation, request)
  }

  private streamWanted(epoch = this.epoch, generation = this.generation): boolean {
    return (
      this.active(epoch) &&
      this.currentGeneration(generation) &&
      !this.suspended &&
      !this.pausedAuth &&
      (Boolean(this.openIDs.size) || (this.wantedList && (this.resolving || this.scope !== null)))
    )
  }

  private syncStream(): void {
    if (!this.streamWanted()) {
      this.stopStream()
      this.remote = null
      return
    }
    if (this.abort) return
    const abort = new AbortController()
    const epoch = this.epoch
    const generation = this.generation
    this.abort = abort
    void this.consume(abort.signal, epoch, generation).catch((err) => {
      if (this.active(epoch) && this.currentGeneration(generation)) this.opts.log("stream loop failed", err)
    })
  }

  private stopStream(): void {
    this.abort?.abort()
    this.abort = null
  }

  private lock(generation = this.generation): void {
    if (!this.currentGeneration(generation)) return
    this.generation++
    this.listEpoch++
    this.admitting = false
    this.metadata.clear()
    this.pending()
    this.stopStream()
    this.reset()
  }

  private pending(): void {
    this.loadEpoch++
    this.loads.clear()
    this.reconcile = Boolean(this.openIDs.size)
    if (this.openIDs.size) this.opts.post({ type: "agentManager.cloudSessionsPending", sessionIDs: [...this.openIDs] })
  }

  private pause(generation = this.generation, invalidate = true): void {
    if (!this.currentGeneration(generation)) return
    if (invalidate) this.invalidateCreate()
    this.pausedAuth = true
    this.suspended = true
    if (this.wantedContext) this.opts.post({ type: "agentManager.cloudCreateContext", status: "signed-out" })
    this.lock(generation)
    if (this.wantedList) this.postList({ status: "error", sessions: this.listRows(), error: AUTH_ERROR })
    if (this.openIDs.size) this.opts.post({ type: "error", message: AUTH_ERROR })
  }

  private readiness(err: CloudAgentDisconnectedError | CloudAgentSignedOutError, generation: number): void {
    if (!this.currentGeneration(generation)) return
    this.invalidateCreate()
    this.suspended = true
    if (this.wantedContext) {
      if (err instanceof CloudAgentSignedOutError)
        this.opts.post({ type: "agentManager.cloudCreateContext", status: "signed-out" })
      else this.postContextUnavailable()
    }
    this.lock(generation)
    if (err instanceof CloudAgentSignedOutError && this.wantedList)
      this.postList({ status: "signed-out", sessions: this.listRows() })
  }

  private currentGeneration(generation: number): boolean {
    return this.generation === generation
  }

  private stale(epoch: number, generation: number, err: unknown): boolean {
    return !this.active(epoch) || !this.currentGeneration(generation) || err instanceof StaleError
  }

  private async client(
    epoch = this.epoch,
    generation = this.generation,
  ): Promise<{ client: KiloClient; token: CloudAgentToken }> {
    if (this.pausedAuth) throw new StaleError()
    const token = await this.getToken(epoch, generation).catch((err) => {
      if (err instanceof CloudAgentDisconnectedError || err instanceof CloudAgentSignedOutError) {
        this.readiness(err, generation)
        throw new AuthRejectedError(message(err, "Cloud Agent authentication failed"))
      }
      throw err
    })
    if (!this.active(epoch) || !this.currentGeneration(generation)) throw new StaleError()
    if (this.remote?.token === token) return this.remote
    const client = this.create({ baseUrl: token.kiloFacadeUrl, headers: { Authorization: `Bearer ${token.token}` } })
    if (!this.active(epoch) || !this.currentGeneration(generation)) throw new StaleError()
    this.remote = { client, token }
    return this.remote
  }

  private async getToken(epoch: number, generation: number): Promise<CloudAgentToken> {
    for (const attempt of [0, 1]) {
      try {
        const token = await this.token.get()
        if (!this.active(epoch) || !this.currentGeneration(generation)) throw new StaleError()
        return token
      } catch (err) {
        if (
          !this.active(epoch) ||
          !this.currentGeneration(generation) ||
          (err instanceof CloudAgentStaleTokenError && attempt === 1)
        )
          throw new StaleError()
        if (!(err instanceof CloudAgentStaleTokenError)) throw err
      }
    }
    throw new StaleError()
  }

  private reset(): void {
    this.remote = null
    this.token.clear()
  }

  private async rest<T>(
    epoch: number,
    generation: number,
    run: (client: KiloClient, token: CloudAgentToken) => Promise<T>,
  ): Promise<T> {
    for (const attempt of [0, 1]) {
      try {
        const remote = await this.client(epoch, generation)
        const result = await run(remote.client, remote.token)
        if (!this.active(epoch) || !this.currentGeneration(generation)) throw new StaleError()
        this.remote401 = 0
        return result
      } catch (err) {
        if (err instanceof AuthRejectedError) throw err
        if (!this.active(epoch) || !this.currentGeneration(generation) || err instanceof StaleError)
          throw new StaleError()
        if (!isCloudAgentUnauthorized(err)) throw err
        this.remote401++
        if (attempt === 1) {
          this.pause(generation)
          throw new AuthRejectedError(message(err, "Cloud Agent authentication failed"))
        }
        this.reset()
      }
    }
    throw new StaleError()
  }

  private async list(epoch: number, generation: number, request: number): Promise<void> {
    const root = this.opts.getRoot()
    const result = await resolveCloudRepository(root, this.opts.remoteUrl).then(
      (repository) => ({ repository }) as const,
      (error) => ({ error }) as const,
    )
    if (!this.listing(epoch, generation, request, root)) return
    this.resolving = false
    if ("error" in result) {
      this.unavailable(result.error)
      return
    }

    const same = this.scope === result.repository.gitUrl
    this.scopeRoot = root
    if (!same) {
      this.sessions = []
      this.scope = result.repository.gitUrl
      for (const id of this.observed.keys()) {
        if (!this.openIDs.has(id)) this.observed.delete(id)
      }
    } else if (this.sessions.length) {
      this.postList({ status: "loading", sessions: this.sessions })
    }
    await this.fetch(epoch, generation, request, root, result.repository)
  }

  private listing(epoch: number, generation: number, request: number, root: string | undefined): boolean {
    if (!this.active(epoch) || !this.currentGeneration(generation) || this.listEpoch !== request) return false
    if (this.opts.getRoot() === root) return true
    this.discover()
    return false
  }

  private unavailable(err: unknown): void {
    this.admitting = false
    this.metadata.clear()
    this.sessions = []
    this.scope = null
    this.scopeRoot = null
    for (const id of this.observed.keys()) {
      if (!this.openIDs.has(id)) this.observed.delete(id)
    }
    this.syncStream()
    if (err instanceof CloudRepositoryUnavailableError) {
      this.postList({ status: "ready", sessions: [] })
      return
    }
    this.postList({ status: "error", sessions: [], error: message(err, "Failed to resolve repository") })
  }

  private async fetch(
    epoch: number,
    generation: number,
    request: number,
    root: string | undefined,
    repository: Repository,
  ): Promise<void> {
    try {
      const sessions = await this.rest(epoch, generation, (_client, token) =>
        this.listSessions({ url: token.kiloFacadeUrl, token: token.token, gitUrl: repository.gitUrl }),
      )
      if (!this.listing(epoch, generation, request, root)) return
      this.apply(sessions, repository.name)
    } catch (err) {
      if (!this.active(epoch) || !this.currentGeneration(generation) || err instanceof StaleError) return
      if (!this.listing(epoch, generation, request, root)) return
      this.admitting = false
      this.repair()
      this.postList({
        status: "error",
        sessions: this.sessions,
        error: this.pausedAuth ? AUTH_ERROR : message(err, "Failed to load Cloud Agent sessions"),
      })
    }
  }

  private apply(sessions: Session[], repository: string): void {
    const incoming = sessions.map(toCloudSummary)
    const allowed = new Set([...this.openIDs, ...incoming.map((session) => session.id)])
    for (const id of this.admitted) {
      if (!allowed.has(id)) this.admitted.delete(id)
    }
    for (const id of allowed) this.admitted.add(id)
    const observed = new Map(this.observed)
    for (const item of this.metadata.values()) {
      const current = observed.get(item.version.value.id)
      observed.set(item.version.value.id, current ? pickCloudSummary(current, item.version) : item.version)
    }
    const versions = mergeCloudSummaries(incoming, observed)
    this.sessions = versions.map((version) => version.value)
    const ids = new Set([...this.openIDs, ...this.sessions.map((session) => session.id)])
    for (const id of this.observed.keys()) {
      if (!ids.has(id)) this.observed.delete(id)
    }
    for (const version of versions) this.observed.set(version.value.id, version)
    const metadata = [...this.metadata.values()]
    this.metadata.clear()
    this.admitting = false
    this.postList({ status: "ready", sessions: this.sessions, repository })
    const listed = new Map(incoming.map((session) => [session.id, session]))
    for (const item of metadata) {
      const admitted = this.observed.get(item.version.value.id)
      const base = listed.get(item.version.value.id)
      if (admitted === item.version && base && !item.posted && !equalCloudSummary(base, item.version.value))
        this.opts.post(item.output)
    }
  }

  private repair(): void {
    const ids = new Set(this.sessions.map((session) => session.id))
    for (const item of this.metadata.values()) {
      if (!ids.has(item.version.value.id)) continue
      if (this.acceptVersion(item.version) && !item.posted) this.opts.post(item.output)
    }
    this.metadata.clear()
  }

  private listRows(): CloudAgentSessionSummary[] {
    return this.resolving || this.opts.getRoot() !== this.scopeRoot ? [] : this.sessions
  }

  private postList(state: CloudAgentListState): void {
    this.opts.post({ type: "agentManager.cloudSessions", ...state })
  }

  private async commands(sessionID: string, requestID?: number): Promise<void> {
    const epoch = this.epoch
    const generation = this.generation
    try {
      const res = await this.rest(epoch, generation, (client) =>
        client.command.list({ directory: cloudDirectory(sessionID) }, { throwOnError: true }),
      )
      if (!this.owns(sessionID)) return
      this.opts.post({
        type: "commandsLoaded",
        sessionID,
        ...(requestID === undefined ? {} : { requestID }),
        commands: res.data.map((command) => ({
          name: command.name,
          description: command.description,
          source: command.source,
          hints: command.hints,
        })),
      })
    } catch (err) {
      if (!this.owns(sessionID) || this.stale(epoch, generation, err)) return
      this.opts.post({ type: "error", sessionID, message: message(err, "Failed to load Cloud Agent commands") })
    }
  }

  private async load(sessionID: string, signal?: AbortSignal): Promise<Snapshot | null> {
    const snapshot = await this.snapshot(sessionID, signal)
    if (
      !snapshot ||
      snapshot === STARTUP_PENDING ||
      snapshot === SNAPSHOT_FAILED ||
      !this.current(snapshot.sessionID, snapshot.epoch, snapshot.generation, snapshot.loadEpoch, snapshot.request)
    )
      return null
    this.publish(snapshot)
    return snapshot
  }

  private async snapshot(
    sessionID: string,
    signal?: AbortSignal,
  ): Promise<Snapshot | typeof STARTUP_PENDING | typeof SNAPSHOT_FAILED | null> {
    const epoch = this.epoch
    const generation = this.generation
    const loadEpoch = this.loadEpoch
    const request = (this.loads.get(sessionID) ?? 0) + 1
    const event = this.events.get(sessionID) ?? 0
    this.loads.set(sessionID, request)
    try {
      const directory = cloudDirectory(sessionID)
      const opts = { throwOnError: true as const, ...(signal ? { signal } : {}) }
      const [detail, transcript, statuses] = await this.rest(epoch, generation, (client) =>
        Promise.all([
          client.session.get({ sessionID, directory }, opts),
          client.session.messages({ sessionID, directory }, opts),
          client.session.status({ directory }, opts),
        ]),
      )
      if (!this.current(sessionID, epoch, generation, loadEpoch, request)) return null
      if (!statuses.data) throw new Error("Cloud Agent status response is missing data")
      const status = statuses.data[sessionID]
      this.startups.delete(sessionID)
      const entries = transcript.data ?? []
      for (const item of entries) this.confirmations.confirm(item.info.id)
      const messages = entries.map((item) => ({
        ...slimInfo(item.info),
        parts: slimParts(item.parts),
        createdAt: new Date(item.info.time.created).toISOString(),
      }))
      return {
        sessionID,
        epoch,
        generation,
        loadEpoch,
        request,
        event,
        status: sessionStatusToWebview(sessionID, status ?? { type: "idle" }),
        ...(detail.data ? { detail: sessionToWebview(detail.data) } : {}),
        transcript: { type: "messagesLoaded", sessionID, messages, mode: "replace", hasMore: false },
      }
    } catch (err) {
      if (!this.current(sessionID, epoch, generation, loadEpoch, request) || err instanceof StaleError) return null
      if (this.startups.has(sessionID)) return STARTUP_PENDING
      this.opts.post({ type: "error", sessionID, message: message(err, "Failed to load Cloud Agent messages") })
      return SNAPSHOT_FAILED
    }
  }

  private publish(snapshot: Snapshot): void {
    this.opts.post(snapshot.status)
    if (snapshot.detail) {
      const next = toCloudSummary(snapshot.detail)
      const current = this.observed.get(snapshot.sessionID)
      const live = (this.events.get(snapshot.sessionID) ?? 0) !== snapshot.event
      if ((!live || current?.value.updatedAt !== next.updatedAt) && this.acceptSummary(snapshot.detail, "detail"))
        this.opts.post({ type: "sessionUpdated", session: snapshot.detail })
    }
    this.opts.post(snapshot.transcript)
  }

  private current(sessionID: string, epoch: number, generation: number, loadEpoch: number, request: number): boolean {
    return (
      this.active(epoch) &&
      this.currentGeneration(generation) &&
      this.loadEpoch === loadEpoch &&
      this.openIDs.has(sessionID) &&
      this.loads.get(sessionID) === request
    )
  }

  private async send(input: Message): Promise<void> {
    const epoch = this.epoch
    const generation = this.generation
    const sessionID = input.sessionID!
    const text = typeof input.text === "string" ? input.text : ""
    const messageID = typeof input.messageID === "string" ? input.messageID : undefined
    const draftID = typeof input.draftID === "string" ? input.draftID : undefined
    const files = Array.isArray(input.files) ? input.files : undefined
    const providerID = typeof input.providerID === "string" ? input.providerID : undefined
    const modelID = typeof input.modelID === "string" ? input.modelID : undefined
    const agent = typeof input.agent === "string" ? input.agent : undefined
    const blocked = this.sendBlocked()
    if (blocked) {
      this.reject(input, blocked)
      return
    }
    if (!validSend(text, draftID, files, providerID, modelID, agent)) {
      this.reject(input, "Cloud Agent follow-ups require plain text, a Kilo model, and an agent")
      return
    }
    try {
      await this.rest(epoch, generation, (client) =>
        client.session.promptAsync(
          {
            sessionID,
            directory: cloudDirectory(sessionID),
            messageID,
            parts: [{ type: "text", text }],
            model: { providerID: "kilo", modelID: modelID! },
            agent: agent!,
          },
          { throwOnError: true },
        ),
      )
    } catch (err) {
      if (!(err instanceof AuthRejectedError) && this.stale(epoch, generation, err)) return
      this.reject(input, message(err, "Failed to send Cloud Agent message"))
    }
  }

  private async command(input: Message): Promise<void> {
    const blocked = this.sendBlocked()
    if (blocked) {
      this.reject(input, blocked)
      return
    }
    const parsed = parseCloudCommand(input, this.sessionID(input))
    if (!parsed) {
      this.reject(input, "Cloud Agent commands require a Kilo model and do not support attachments")
      return
    }
    const epoch = this.epoch
    const generation = this.generation
    const release = this.confirmations.track(parsed.messageID)
    try {
      await this.rest(epoch, generation, (client) =>
        client.session.command(
          {
            ...parsed,
            directory: cloudDirectory(parsed.sessionID),
            snapshotInitialization: SNAPSHOT_INITIALIZATION,
          },
          { throwOnError: true },
        ),
      )
    } catch (err) {
      if (err instanceof AuthRejectedError) {
        this.reject(input, message(err, "Failed to send Cloud Agent command"))
        return
      }
      if (this.stale(epoch, generation, err)) return
      if (await this.confirmations.wait(parsed.messageID, this.confirmation)) {
        this.opts.log("command request ended after Cloud Agent accepted it; ignoring transport error", err)
        return
      }
      if (!this.owns(parsed.sessionID) || this.suspended || this.reconcile) return
      this.reject(input, message(err, "Failed to send Cloud Agent command"))
    } finally {
      release()
    }
  }

  private sendBlocked(): string | undefined {
    if (this.pausedAuth) return AUTH_ERROR
    if (this.suspended || this.reconcile) return "Cloud Agent connection is not ready. Retry after reconnecting."
  }

  private reject(input: Message, error: string): void {
    this.opts.post({
      type: "sendMessageFailed",
      error,
      text: restore(input),
      sessionID: this.sessionID(input),
      draftID: typeof input.draftID === "string" ? input.draftID : undefined,
      messageID: typeof input.messageID === "string" ? input.messageID : undefined,
      files: Array.isArray(input.files) ? input.files : undefined,
    })
  }

  private async stop(sessionID: string): Promise<void> {
    const epoch = this.epoch
    const generation = this.generation
    try {
      await this.rest(epoch, generation, (client) =>
        client.session.abort({ sessionID, directory: cloudDirectory(sessionID) }, { throwOnError: true }),
      )
    } catch (err) {
      if (this.stale(epoch, generation, err)) return
      this.opts.post({ type: "error", sessionID, message: message(err, "Failed to abort Cloud Agent session") })
    }
  }

  private async consume(signal: AbortSignal, epoch: number, generation: number): Promise<void> {
    let backoff = RECONNECT_MS
    let reconnect = this.reconcile
    while (!signal.aborted && this.streamWanted(epoch, generation)) {
      const usable = await this.stream(signal, epoch, generation, reconnect).catch((err) => {
        if (!this.active(epoch) || !this.currentGeneration(generation) || signal.aborted) return false
        if (isCloudAgentUnauthorized(err)) {
          this.remote401++
          if (this.remote401 > 1) {
            this.pause(generation)
            return false
          }
          this.reset()
        }
        this.opts.log("stream failed", err)
        return false
      })
      this.remote = null
      if (signal.aborted || !this.streamWanted(epoch, generation)) return
      if (this.openIDs.size) this.pending()
      await this.wait(backoff, signal)
      if (signal.aborted || !this.streamWanted(epoch, generation)) return
      reconnect = true
      backoff = usable ? RECONNECT_MS : Math.min(backoff * 2, MAX_RECONNECT_MS)
    }
  }

  private async stream(signal: AbortSignal, epoch: number, generation: number, reconnect: boolean): Promise<boolean> {
    const attempt = new AbortController()
    const abort = () => attempt.abort()
    signal.addEventListener("abort", abort)
    const timeout = this.opts.heartbeat ?? HEARTBEAT_MS
    const heartbeat = new SSEHeartbeat(timeout, abort)
    const deadline = new SSEHeartbeat(timeout, abort)
    const buffer: GlobalEvent[] = []
    let first = false
    let failure: unknown
    let hydration: Promise<void> | null = null
    let hydrated = !reconnect
    let usable = false
    const frame = () => {
      if (attempt.signal.aborted || signal.aborted || !this.active(epoch) || !this.currentGeneration(generation)) return
      heartbeat.reset()
      this.remote401 = 0
      if (first) return
      first = true
      if (!reconnect || !this.openIDs.size) {
        hydrated = true
        usable = true
        return
      }
      deadline.reset()
      hydration = abortable(
        this.hydrate(epoch, generation, attempt.signal, () => deadline.reset()),
        attempt.signal,
      ).then(
        () => {
          if (attempt.signal.aborted || !this.active(epoch) || !this.currentGeneration(generation)) return
          deadline.dispose()
          for (const item of buffer.splice(0)) this.event(item)
          hydrated = true
          usable = true
          this.reconcile = false
          this.drainLoads()
        },
        (err) => {
          failure ??= err
          abort()
        },
      )
    }
    try {
      heartbeat.reset()
      const remote = await this.client(epoch, generation)
      const events = await remote.client.global.event({
        signal: attempt.signal,
        sseMaxRetryAttempts: 1,
        onSseEvent: frame,
        onSseError: (err) => {
          failure = err
        },
      })
      for await (const item of events.stream) {
        if (attempt.signal.aborted || signal.aborted || !this.active(epoch) || !this.currentGeneration(generation))
          return usable
        frame()
        const event = item as GlobalEvent
        this.confirm(event.payload as Event)
        const live = parseCloudStatus(event.payload) || parseCloudMessageFailure(event.payload)
        if (!hydrated && !INTERACTIVE.has((event.payload as Event).type) && !live) {
          if (buffer.length >= MAX_BUFFER) throw new Error("Cloud Agent reconnect event buffer exceeded limit")
          buffer.push(event)
          continue
        }
        this.event(event)
      }
      await hydration
      if (failure) throw failure
      return usable
    } finally {
      heartbeat.dispose()
      deadline.dispose()
      signal.removeEventListener("abort", abort)
      attempt.abort()
    }
  }

  private async hydrate(epoch: number, generation: number, signal: AbortSignal, refresh: () => void): Promise<void> {
    let backoff = RECONNECT_MS
    let ids = [...this.openIDs]
    const ready: Snapshot[] = []
    while (!signal.aborted && this.active(epoch) && this.currentGeneration(generation)) {
      const snapshots = await Promise.all(ids.map((id) => this.snapshot(id, signal)))
      if (signal.aborted || !this.active(epoch) || !this.currentGeneration(generation)) throw new StaleError()
      if (snapshots.some((snapshot) => !snapshot)) throw new StaleError()
      const pending: string[] = []
      for (const [index, snapshot] of snapshots.entries()) {
        if (snapshot === STARTUP_PENDING) {
          pending.push(ids[index]!)
          continue
        }
        if (snapshot === SNAPSHOT_FAILED) continue
        if (
          !snapshot ||
          !this.current(snapshot.sessionID, snapshot.epoch, snapshot.generation, snapshot.loadEpoch, snapshot.request)
        )
          throw new StaleError()
        ready.push(snapshot)
      }
      if (!pending.length) {
        for (const snapshot of ready) {
          if (
            !this.current(snapshot.sessionID, snapshot.epoch, snapshot.generation, snapshot.loadEpoch, snapshot.request)
          )
            throw new StaleError()
          this.publish(snapshot)
        }
        return
      }
      ids = pending
      refresh()
      await this.wait(backoff, signal)
      backoff = Math.min(backoff * 2, MAX_RECONNECT_MS)
    }
    throw new StaleError()
  }

  private confirm(event: Event): void {
    const sessionID = eventSessionID(event)
    if (!sessionID || !this.openIDs.has(sessionID)) return
    if (event.type === "message.updated") this.confirmations.confirm(event.properties.info.id)
    const accepted = parseCloudMessageAcceptance(event)
    if (accepted) this.confirmations.confirm(accepted)
  }

  private event(item: GlobalEvent): void {
    const event = item.payload as Event
    const sessionID = eventSessionID(event)
    if (!sessionID) return
    if (event.type === "session.updated") {
      this.update(event, sessionID)
      return
    }
    if (!this.openIDs.has(sessionID)) return
    if (event.type === "session.deleted") {
      this.admitted.delete(sessionID)
      this.openIDs.delete(sessionID)
      this.tombstones.add(sessionID)
      this.startups.delete(sessionID)
      this.loads.delete(sessionID)
      this.pendingLoads.delete(sessionID)
      this.events.delete(sessionID)
      this.opts.post({ type: "agentManager.cloudSessionDeleted", sessionId: sessionID })
      this.opts.post({ type: "sessionDeleted", sessionID })
      this.requestList()
      this.syncStream()
      return
    }
    if (event.type === "session.created") return
    if (INTERACTIVE.has(event.type)) {
      this.unsupported(sessionID)
      return
    }
    const status = parseCloudStatus(event)
    if (status) {
      this.opts.post({ type: "agentManager.cloudStatus", sessionID, cloudStatus: status.cloudStatus })
      return
    }
    const failure = parseCloudMessageFailure(event)
    if (failure) {
      this.opts.post({ type: "agentManager.cloudMessageFailed", ...failure })
      return
    }
    const output = mapSSEEventToWebviewMessage(event, sessionID)
    if (!output) return
    if (output.type === "partUpdated") this.opts.post({ ...output, part: slimPart(output.part) })
    else if (output.type === "messageCreated") this.opts.post({ ...output, message: slimInfo(output.message) })
    else this.opts.post(output)
  }

  private update(event: Event, sessionID: string): void {
    const output = mapSSEEventToWebviewMessage(event, sessionID)
    if (!output || output.type !== "sessionUpdated" || output.session.id !== sessionID) return
    const next: CloudSummaryVersion = { value: toCloudSummary(output.session), source: "event" }
    const open = this.openIDs.has(sessionID)
    if (this.admitting) {
      const item = this.bufferMetadata(next, output)
      if (!open) return
      this.events.set(sessionID, (this.events.get(sessionID) ?? 0) + 1)
      const changed = this.acceptVersion(next)
      if (changed) this.opts.post(output)
      if (item.version === next) item.posted ||= changed
      return
    }
    if (!open && !this.listed(sessionID)) return
    if (open) this.events.set(sessionID, (this.events.get(sessionID) ?? 0) + 1)
    if (this.acceptVersion(next)) this.opts.post(output)
  }

  private listed(sessionID: string): boolean {
    return (
      !this.resolving &&
      this.scope !== null &&
      this.opts.getRoot() === this.scopeRoot &&
      this.sessions.some((session) => session.id === sessionID)
    )
  }

  private bufferMetadata(version: CloudSummaryVersion, output: unknown): Metadata {
    const current = this.metadata.get(version.value.id)
    if (current && pickCloudSummary(current.version, version) !== version) return current
    if (!current && this.metadata.size >= MAX_METADATA) this.metadata.delete(this.metadata.keys().next().value!)
    const item = { version, output, posted: false }
    this.metadata.set(version.value.id, item)
    return item
  }

  private acceptSummary(session: ReturnType<typeof sessionToWebview>, source: CloudSummarySource): boolean {
    return this.acceptVersion({ value: toCloudSummary(session), source })
  }

  private acceptVersion(next: CloudSummaryVersion): boolean {
    const current = this.observed.get(next.value.id)
    const picked = current ? pickCloudSummary(current, next) : next
    if (picked !== next) return false
    this.observed.set(next.value.id, next)
    this.sessions = replaceCloudSummary(this.sessions, next.value)
    return !current || !equalCloudSummary(current.value, next.value)
  }

  private drainLoads(): void {
    for (const sessionID of this.pendingLoads) {
      this.pendingLoads.delete(sessionID)
      if (this.openIDs.has(sessionID)) void this.load(sessionID)
    }
  }

  private unsupported(sessionID: string): void {
    this.opts.post({ type: "error", sessionID, message: UNSUPPORTED })
    if (this.stops.has(sessionID)) return
    this.stops.add(sessionID)
    void this.stop(sessionID).finally(() => this.stops.delete(sessionID))
  }
}

class StaleError extends Error {}
class AuthRejectedError extends Error {}

function validSend(
  text: string,
  draftID: string | undefined,
  files: unknown[] | undefined,
  providerID: string | undefined,
  modelID: string | undefined,
  agent: string | undefined,
): boolean {
  return Boolean(text.trim() && !draftID && !files?.length && providerID === "kilo" && modelID?.trim() && agent?.trim())
}

function eventSessionID(event: Event): string | undefined {
  if (!("properties" in event) || !event.properties || typeof event.properties !== "object") return
  if ("sessionID" in event.properties && typeof event.properties.sessionID === "string")
    return event.properties.sessionID
  if ("part" in event.properties) {
    const part = event.properties.part
    if (part && typeof part === "object" && "sessionID" in part && typeof part.sessionID === "string")
      return part.sessionID
  }
  if ("info" in event.properties) {
    const info = event.properties.info
    if (info && typeof info === "object" && "sessionID" in info && typeof info.sessionID === "string")
      return info.sessionID
    if (info && typeof info === "object" && "id" in info && typeof info.id === "string") return info.id
  }
}

function message(err: unknown, fallback: string): string {
  return getErrorMessage(err) || fallback
}

function field(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function restore(input: Message): string {
  if (typeof input.text === "string") return input.text
  if (input.type !== "sendCommand" || typeof input.command !== "string" || typeof input.arguments !== "string")
    return ""
  return `/${input.command} ${input.arguments}`.trim()
}

function createFields(input: Message): { prompt: string; mode: string; model: string } | undefined {
  const fields = { prompt: field(input.prompt), mode: field(input.mode), model: field(input.model) }
  return fields.prompt && fields.mode && fields.model ? fields : undefined
}

function createError(err: unknown): string {
  if (err instanceof CloudAgentStartError) return err.message
  return CREATE_CONTEXT_ERROR
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new StaleError())
  return new Promise((resolve, reject) => {
    const abort = () => reject(new StaleError())
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener("abort", abort)
      resolve()
    }
    const timer = setTimeout(done, ms)
    const abort = () => {
      clearTimeout(timer)
      done()
    }
    signal.addEventListener("abort", abort, { once: true })
  })
}
