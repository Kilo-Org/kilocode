import { scheduler } from "node:timers/promises"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { HostedError, SessionUnavailable } from "./error.js"
import { checkResponse, frames, invalidResponse, json, segment } from "./live-io.js"
import { messages, Projection } from "./live-state.js"
import { History, type Request } from "./live-history.js"
import { followProgress, Preparation } from "./live-progress.js"
import { Broadcast, type OpenBroadcast } from "./live-broadcast.js"
import type { ImageTurn } from "./attachments.js"

type Target = KiloHostedRpc.Target
interface Attachment {
  target: Target
  attachmentID: string
}
interface Options {
  openBroadcast?: OpenBroadcast
  sendImages?: (target: Target, turn: ImageTurn, signal: AbortSignal) => Promise<void>
  authorize(target: Target, signal: AbortSignal): Promise<void | string>
  request: Request
}
const REQUEST_MS = 30_000
const IDLE_MS = 90_000
const expired = () => new HostedError("Cloud session attachment expired. Reopen the session.")
const scoped = (target: Target) => new URLSearchParams({ directory: `/cloud-agent/sessions/${target.sessionID}` })

type Page = Awaited<ReturnType<History["read"]>>
class RouteNotReady extends Error {}

class Lease {
  readonly controller = new AbortController()
  private readonly changes = new EventTarget()
  private readonly idle: ReturnType<typeof setTimeout>
  private revision = 1
  private projection: Projection
  private connection: KiloHostedRpc.Snapshot["connection"] = "connecting"
  private error?: string
  private progress?: KiloHostedRpc.Progress
  private readonly preparation = new Preparation()
  private retry = new AbortController()
  private historyPending = false
  private delivered?: { revision: number; rows: Map<string, KiloHostedRpc.Message> }

  constructor(
    readonly target: Target,
    private readonly options: Options,
    readonly history: History,
    initial: Page | undefined,
    private readonly control: string | undefined,
    private readonly expire: () => void,
  ) {
    this.projection = new Projection(target.sessionID, initial?.rows ?? [], initial?.before)
    this.idle = setTimeout(expire, IDLE_MS)
    this.idle.unref()
    void this.follow(initial).catch(() => this.expire())
    if (control)
      void followProgress(target, options.request, this.controller.signal, this.preparation, (progress) => {
        const ready = this.progress?.phase !== "ready" && progress.phase === "ready"
        this.progress = progress
        if (ready) this.retry.abort()
        this.notify()
      }).catch((error) => this.controller.abort(error))
  }

  touch() {
    if (!this.controller.signal.aborted) this.idle.refresh()
  }
  sent() {
    // A successful prompt can start a sleeping runtime. Probe it without waiting for the passive backoff.
    this.retry.abort()
  }
  close() {
    clearTimeout(this.idle)
    this.controller.abort()
  }

  async read(revision: number | undefined, abort: AbortSignal, incremental = false) {
    const signal = AbortSignal.any([this.controller.signal, abort])
    signal.throwIfAborted()
    if (revision === this.revision) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          this.changes.removeEventListener("change", done)
          signal.removeEventListener("abort", done)
          resolve()
        }
        const timer = setTimeout(done, 15_000)
        this.changes.addEventListener("change", done, { once: true })
        signal.addEventListener("abort", done, { once: true })
      })
    }
    signal.throwIfAborted()
    // A failed first prompt may have no stored transcript or preparation steps. The session's
    // lifecycle still reports the failure, even while its separate compute status says sleeping.
    const error =
      this.projection.empty &&
      (this.progress?.phase === "error" || (!this.progress?.phase && this.progress?.preparation === "failed"))
        ? "Cloud could not start this session. Check the repository access and environment profile, then try again."
        : this.error
    if (revision === this.revision) return { revision }
    const snapshot = {
      ...this.projection.snapshot(this.displayConnection()),
      ...(error && { error }),
      ...(this.progress && { progress: this.progress }),
    }
    const previous = incremental && this.delivered?.revision === revision ? this.delivered?.rows : undefined
    if (incremental)
      this.delivered = { revision: this.revision, rows: new Map(snapshot.messages.map((m) => [m.id, m])) }
    // Full first read or missed revision; subsequent reads transmit only messages changed by the stream.
    if (!previous) return { revision: this.revision, snapshot }
    return {
      revision: this.revision,
      order: snapshot.messages.map((m) => m.id),
      snapshot: { ...snapshot, messages: snapshot.messages.filter((m) => previous.get(m.id) !== m) },
    }
  }

  pending(kind: "questions" | "permissions", id: string) {
    segment(id)
    if (this.connection === "live" && this.projection.snapshot(this.connection)[kind].some((item) => item.id === id))
      return
    throw new HostedError("This Cloud request is no longer pending.")
  }

  private notify() {
    this.revision++
    this.changes.dispatchEvent(new Event("change"))
  }

  private displayConnection(): KiloHostedRpc.Snapshot["connection"] {
    if (this.connection === "disconnected") return this.connection
    const p = this.progress
    if (p?.phase === "preparing" || (!p?.phase && p?.preparation === "running")) return "preparing"
    if (this.connection === "live") return this.connection
    if (p?.sandbox === "starting") return "preparing"
    if (p?.sandbox === "sleeping") return "sleeping"
    if (this.historyPending) return "preparing"
    // A native route that isn't live yet is not proof the sandbox is asleep.
    if (this.control && this.connection === "sleeping") return "connecting"
    return this.connection
  }

  private async follow(initial?: Page) {
    const signal = this.controller.signal
    let pause = 500
    let first = true
    while (!signal.aborted) {
      try {
        const saved = first && initial ? initial : await this.history.read(signal)
        first = false
        this.restorePreparation(saved)
        // A lagging or not-yet-published durable page must never erase the last fenced view on a failed reconnect.
        const draft = saved.rows.length
          ? new Projection(this.target.sessionID, saved.rows, saved.before)
          : this.projection.replay()
        if (this.projection.empty && saved.rows.length) {
          this.projection = new Projection(this.target.sessionID, saved.rows, saved.before)
          this.notify()
        }
        await this.stream(draft)
        if (draft.fenced) pause = 500
        if (!signal.aborted) this.offline("disconnected", "Cloud live updates were interrupted.")
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof SessionUnavailable) {
          this.controller.abort(error)
          return
        }
        if (error instanceof RouteNotReady) this.offline("sleeping")
        else
          this.offline(
            "disconnected",
            error instanceof HostedError ? error.message : "Cloud live updates are unavailable.",
          )
      }
      if (signal.aborted) return
      await scheduler
        .wait(this.displayConnection() === "sleeping" ? 15_000 : pause, {
          signal: AbortSignal.any([signal, this.retry.signal]),
        })
        .catch(() => {})
      this.retry = new AbortController()
      pause = Math.min(pause * 2, 15_000)
    }
  }

  private restorePreparation(saved: Page) {
    const pending = "pending" in saved && saved.pending === true
    const progress = this.preparation.fromPage("attempts" in saved ? saved.attempts : undefined)
    if (this.historyPending === pending && !progress) return
    this.historyPending = pending
    if (progress) this.progress = progress
    this.notify()
  }

  private offline(connection: "sleeping" | "disconnected", error?: string) {
    if (this.connection === connection && this.error === error) return
    this.connection = connection
    this.error = error
    this.notify()
  }

  private async stream(draft: Projection) {
    const timeout = new AbortController()
    const signal = AbortSignal.any([this.controller.signal, timeout.signal])
    const timer = setTimeout(() => timeout.abort(), REQUEST_MS)
    let broadcast: Broadcast | undefined
    const apply = (event: unknown) => {
      const changed = draft.apply(event)
      if (!draft.fenced || !changed) return false
      this.connection = "live"
      this.error = undefined
      this.projection = draft
      this.notify()
      return true
    }
    try {
      const response = await this.options.request(this.target, `/kilo/event?${scoped(this.target)}`, {
        method: "GET",
        headers: { accept: "text/event-stream" },
        signal,
      })
      if (response.status === 503) {
        const failure = await json(new Response(response.body), signal, 4096)
        if (
          failure &&
          typeof failure === "object" &&
          "error" in failure &&
          failure.error === "KILO_LIVE_RUNTIME_UNAVAILABLE"
        )
          throw new RouteNotReady()
        throw new HostedError("Cloud live updates are temporarily unavailable.")
      }
      for await (const event of frames(response, signal, () => timer.refresh())) {
        if (!broadcast || broadcast.native(event)) apply(event)
        if (draft.fenced && !broadcast && this.control && this.options.openBroadcast) {
          broadcast = new Broadcast(this.target.sessionID)
          // A refused ticket or unavailable socket leaves the fenced native stream in place.
          void broadcast
            .follow(this.options.openBroadcast, this.target, this.control, signal, apply, () => timeout.abort())
            .catch(() => {})
        }
      }
    } finally {
      clearTimeout(timer)
      timeout.abort()
    }
  }
}

export function createLive(options: Options) {
  const leases = new Map<string, Lease>()
  const lifetime = new AbortController()

  function drop(id: string) {
    leases.get(id)?.close()
    leases.delete(id)
  }

  function lease(input: Attachment) {
    const current = leases.get(input.attachmentID)
    const target = current?.target
    if (
      !current ||
      !target ||
      target.providerID !== input.target.providerID ||
      target.scope !== input.target.scope ||
      target.workspaceID !== input.target.workspaceID ||
      target.sessionID !== input.target.sessionID
    )
      throw expired()
    current.touch()
    return current
  }

  async function post(current: Lease, abort: AbortSignal, path: string, value: unknown, empty = false) {
    const signal = AbortSignal.any([abort, current.controller.signal, AbortSignal.timeout(REQUEST_MS)])
    const body = JSON.stringify(value)
    if (Buffer.byteLength(body) > 256 * 1024) throw new HostedError("Cloud session input is too large.")
    const response = await options.request(current.target, path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal,
    })
    await checkResponse(response)
    if (empty && response.status === 204) return {}
    if (!empty && (await json(response, signal, 128)) === true) return {}
    await response.body?.cancel().catch(() => {})
    throw invalidResponse()
  }

  return {
    async attach({ target }: { target: Target }, abort: AbortSignal) {
      segment(target.sessionID)
      segment(target.workspaceID)
      if (target.providerID !== "kilo-cloud") throw expired()
      const signal = AbortSignal.any([abort, lifetime.signal, AbortSignal.timeout(REQUEST_MS)])
      const control = await options.authorize(target, signal)
      const history = new History(target, options.request, control)
      // Catalog membership authorizes the attachment. Its independent system feed must be able to
      // paint preparation before a newly allocated root has registered or published history.
      const grouped = control && control.startsWith("workspace_") ? control : undefined
      const saved = grouped ? undefined : await history.read(signal)
      signal.throwIfAborted()
      if (leases.size >= 32) throw new HostedError("Too many Cloud sessions are open.")
      const attachmentID = crypto.randomUUID()
      leases.set(attachmentID, new Lease(target, options, history, saved, grouped, () => drop(attachmentID)))
      return { attachmentID }
    },
    read(input: Attachment & { revision?: number; incremental?: boolean }, signal: AbortSignal) {
      return lease(input).read(input.revision, signal, input.incremental)
    },
    async history(input: Attachment & { before: string }, signal: AbortSignal) {
      const current = lease(input)
      const prior = await current.history.read(AbortSignal.any([signal, current.controller.signal]), input.before)
      return { messages: messages(prior.rows), ...(prior.before && { before: prior.before }) }
    },
    async childHistory(input: Attachment & { childID: string; before?: string }, signal: AbortSignal) {
      const current = lease(input)
      const bound = AbortSignal.any([signal, current.controller.signal])
      await options.authorize(current.target, bound)
      const prior = await current.history.read(bound, input.before, segment(input.childID))
      return { messages: messages(prior.rows), ...(prior.before && { before: prior.before }) }
    },
    async prompt(
      input: Attachment & {
        messageID: string
        text: string
        agent?: string
        model?: string
        attachments?: readonly string[]
      },
      signal: AbortSignal,
    ) {
      const current = lease(input)
      if (
        !/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(input.messageID) ||
        (!input.text.trim() && !input.attachments?.length) ||
        input.text.length > 100_000
      ) {
        throw new HostedError("Invalid Cloud session prompt.")
      }
      if (input.attachments) {
        if (!options.sendImages) throw new HostedError("Cloud image dispatch is unavailable.")
        await options.sendImages(
          current.target,
          { ...input, attachments: input.attachments },
          AbortSignal.any([signal, current.controller.signal]),
        )
        current.sent()
        return {}
      }
      const result = await post(
        current,
        signal,
        `/kilo/session/${current.target.sessionID}/prompt_async`,
        {
          messageID: input.messageID,
          ...(input.agent && { agent: input.agent }),
          ...(input.model && { model: { providerID: "kilo", modelID: input.model } }),
          parts: [{ type: "text", text: input.text }],
        },
        true,
      )
      current.sent()
      return result
    },
    interrupt(input: Attachment, signal: AbortSignal) {
      const current = lease(input)
      return post(current, signal, `/kilo/session/${current.target.sessionID}/abort`, {})
    },
    async command(
      input: Attachment & { messageID: string; command: string; arguments: string; agent?: string; model?: string },
      signal: AbortSignal,
    ) {
      const current = lease(input)
      const { target, attachmentID: _, ...body } = input
      if (!/^[\w.-]+$/.test(body.command)) throw new HostedError("Invalid Cloud command name.")
      const result = await post(current, signal, `/kilo/session/${segment(target.sessionID)}/command`, body, true)
      current.sent()
      return result
    },
    replyQuestion(
      input: Attachment & { requestID: string; answers: readonly (readonly string[])[] },
      signal: AbortSignal,
    ) {
      const current = lease(input)
      current.pending("questions", input.requestID)
      if (input.answers.length > 32 || input.answers.some((a) => a.length > 256 || a.some((v) => v.length > 10_000))) {
        throw new HostedError("Invalid Cloud question answers.")
      }
      return post(current, signal, `/kilo/question/${input.requestID}/reply?${scoped(current.target)}`, {
        answers: input.answers,
      })
    },
    rejectQuestion(input: Attachment & { requestID: string }, signal: AbortSignal) {
      const current = lease(input)
      current.pending("questions", input.requestID)
      return post(current, signal, `/kilo/question/${input.requestID}/reject?${scoped(current.target)}`, {})
    },
    replyPermission(
      input: Attachment & { requestID: string; reply: "once" | "always" | "reject" },
      signal: AbortSignal,
    ) {
      const current = lease(input)
      current.pending("permissions", input.requestID)
      return post(current, signal, `/kilo/permission/${input.requestID}/reply?${scoped(current.target)}`, {
        reply: input.reply,
      })
    },
    async detach(input: Attachment, _signal: AbortSignal) {
      lease(input)
      drop(input.attachmentID)
      return {}
    },
    close() {
      lifetime.abort()
      for (const key of leases.keys()) drop(key)
    },
  }
}
