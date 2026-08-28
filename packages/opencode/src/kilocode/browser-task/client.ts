import { NamedError } from "@opencode-ai/core/util/error"
import { Effect, Redacted, Schema } from "effect"
import { RemoteProtocol } from "../../kilo-sessions/remote-protocol"
import type { RemoteWS } from "../../kilo-sessions/remote-ws"
import type { BrowserOwner } from "./owner"

export namespace BrowserClient {
  type Owner = Effect.Success<ReturnType<typeof BrowserOwner.open>>
  type Intent = Awaited<ReturnType<Owner["prepare"]>> & { handle?: Handle }
  type Request = RemoteProtocol.BrowserRequest extends infer R
    ? R extends RemoteProtocol.BrowserRequest
      ? Omit<R, "type" | "requestId">
      : never
    : never
  type Response = RemoteProtocol.BrowserResponse["response"]
  type Job = RemoteProtocol.BrowserJobSnapshot
  type Handle = RemoteProtocol.BrowserJobHandle
  type Update = Job | RemoteProtocol.BrowserResult
  type Watch = { intent: Intent; handle?: Handle; latest?: Update; lost?: number }
  type Hooks = { signal: AbortSignal; metadata: (output: Output) => Promise<void> }
  export type Output = {
    status: string
    reason: string
    summary: string
    evidence: RemoteProtocol.BrowserResult["evidence"]
    effectsUncertain: boolean
    retryable?: boolean
    provider_id?: string
    browser_task_id?: string
    job_id?: string
    invocation_id?: string
    guidance?: string
    providers?: RemoteProtocol.BrowserResponse["response"] extends infer R
      ? R extends { kind: "providers"; providers: infer P }
        ? P
        : never
      : never
    jobs?: Output[]
  }
  export type Client = ReturnType<typeof create>
  type Failure = InstanceType<typeof Error>
  export const Error = NamedError.create("BrowserClientError", {
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  })
  const recovery = "Use browser_task with operation=recover to retrieve stored status without replay."
  const panel = "Enable CLI tasks for the browser profile and keep its signed-in panel open. Refresh operation=list."
  const uncertain =
    "Close the affected bound tabs, release execution locks, and use the panel recovery action. " +
    "Then explicitly continue with provider_id and browser_task_id and approve a fresh tab."

  function failure(code: string, retryable = false) {
    const messages: Record<string, string> = {
      remote_disabled: "Remote access is disabled. Sign in with `kilo auth login`, then explicitly enable `/remote`.",
      unsupported: "The relay does not support browser tasks. Update the relay before retrying.",
      delivery_interrupted:
        "Browser result delivery was interrupted; this does not establish browser failure. " + recovery,
      provider_unavailable: "The selected browser provider is unavailable. " + panel,
      capacity_exceeded: "The browser queue or retained job limit is full. Wait for capacity, then refresh discovery.",
      cancelled: "The tool call was cancelled. Cancellation does not undo browser actions already issued.",
      invalid_response: "The browser response does not match this parent's request. No result was delivered.",
    }
    return new Error({ code, message: messages[code] ?? `Browser request rejected: ${code}.`, retryable })
  }

  export function rejected(err: unknown): Output {
    const data =
      err instanceof Error
        ? err.data
        : { code: "storage_unavailable", message: "Browser state is unavailable.", retryable: true }
    return {
      status: data.code === "delivery_interrupted" ? "interrupted" : "rejected",
      reason: data.code,
      summary: data.message,
      evidence: [],
      effectsUncertain: data.code === "delivery_interrupted" || data.code === "effects_uncertain",
      retryable: data.retryable,
      ...(data.code === "effects_uncertain" ? { guidance: uncertain } : {}),
      ...(data.code === "delivery_interrupted" ? { guidance: recovery } : {}),
    }
  }

  function ids(handle: Partial<Record<keyof Handle, string>>) {
    return {
      provider_id: handle.providerId,
      browser_task_id: handle.browserTaskId,
      job_id: handle.jobId,
      invocation_id: handle.invocationId,
    }
  }

  function output(update: Update): Output {
    const result = "result" in update ? update.result : "summary" in update ? update : undefined
    return {
      ...ids(update),
      status: update.status,
      reason: result?.reason ?? update.status,
      summary:
        result?.summary ??
        `Browser task is ${update.status}. Keep the browser panel open; approve a tab when requested.`,
      evidence: result?.evidence ?? [],
      effectsUncertain: result?.effectsUncertain ?? false,
      ...(result?.effectsUncertain ? { guidance: uncertain } : {}),
    }
  }

  function matches(expected: Partial<Record<keyof Handle, string>>, actual: Handle) {
    return (["providerId", "browserTaskId", "jobId", "invocationId"] as const).every(
      (key) => expected[key] === undefined || expected[key] === actual[key],
    )
  }

  function terminal(update: Update | undefined) {
    return !!update && RemoteProtocol.BrowserTerminalStatus.safeParse(update.status).success
  }

  function verify(record: Intent, job: Job) {
    // The local fingerprint guards immutable intent reuse in prepare(), not relay snapshots.
    // The authenticated relay binds its different fingerprint to the user and parent proof.
    if (
      !matches(
        { providerId: record.providerId, invocationId: record.invocationId, browserTaskId: record.browserTaskId },
        job,
      ) ||
      (record.handle && !matches(record.handle, job))
    )
      throw failure("invalid_response")
  }

  export function create(
    connection: () => Pick<RemoteWS.Connection, "send" | "heartbeat" | "connected">,
    options: { timers?: Pick<RemoteWS.Timers, "setTimeout" | "clearTimeout">; now?: () => number } = {},
  ) {
    const timers = options.timers ?? {
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
      clearTimeout: (id: unknown) => clearTimeout(Number(id)),
    }
    const now = options.now ?? Date.now
    const pending = new Map<string, { resolve: (value: Response) => void; reject: (err: Failure) => void }>()
    const routes = new Map<string, Watch>()
    const watches = new Set<Watch>()
    const changes = new Set<() => void>()
    let state: "pending" | "ready" | "unsupported" | "closed" = "pending"

    function wake() {
      for (const notify of changes) notify()
    }

    function check(signal: AbortSignal) {
      if (signal.aborted) throw failure("cancelled")
    }

    function pause(ms: number, signal: AbortSignal, changing = false) {
      check(signal)
      return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          timers.clearTimeout(timer)
          changes.delete(finish)
          signal.removeEventListener("abort", abort)
        }
        const finish = () => {
          cleanup()
          resolve()
        }
        const abort = () => {
          cleanup()
          reject(failure("cancelled"))
        }
        const timer = timers.setTimeout(finish, Math.max(0, ms))
        if (changing) changes.add(finish)
        signal.addEventListener("abort", abort, { once: true })
      })
    }

    async function ready(signal: AbortSignal, end: number) {
      const deadline = Math.min(end, now() + 5_000)
      while (true) {
        check(signal)
        if (state === "ready" && connection().connected) return
        if (state === "unsupported") throw failure("unsupported")
        if (state === "closed" || now() >= deadline) throw failure("delivery_interrupted", true)
        await pause(deadline - now(), signal, true)
      }
    }

    async function request(input: Request, signal: AbortSignal, end: number, watch?: Watch): Promise<Response> {
      await ready(signal, end)
      check(signal)
      if (now() >= end) throw failure("delivery_interrupted", true)
      const requestId = crypto.randomUUID()
      const message = RemoteProtocol.BrowserRequest.parse({ ...input, type: "browser_request", requestId })
      const deferred = Promise.withResolvers<Response>()
      const abort = () => deferred.reject(failure("cancelled"))
      const timer = timers.setTimeout(
        () => deferred.reject(failure("delivery_interrupted", true)),
        Math.min(10_000, end - now()),
      )
      pending.set(requestId, deferred)
      if (watch) routes.set(requestId, watch)
      signal.addEventListener("abort", abort, { once: true })
      try {
        try {
          if (!connection().send(message, { connectedOnly: true }))
            deferred.reject(failure("delivery_interrupted", true))
        } catch {
          deferred.reject(failure("delivery_interrupted", true))
        }
        const response = await deferred.promise
        if (response.kind === "error") throw failure(response.code, response.retryable)
        return response
      } finally {
        timers.clearTimeout(timer)
        signal.removeEventListener("abort", abort)
        pending.delete(requestId)
        // A live job keeps its correlated event route until its tool call settles.
        if (!watch) routes.delete(requestId)
      }
    }

    const authority = (owner: Owner) => ({
      parentSessionId: owner.parentSessionId,
      parentProof: Redacted.value(owner.proof),
    })

    async function retry<T>(fn: () => Promise<T>, signal: AbortSignal, end: number): Promise<T> {
      while (true) {
        check(signal)
        try {
          return await fn()
        } catch (err) {
          if (!(err instanceof Error) || err.data.code !== "delivery_interrupted" || now() >= end) throw err
          await pause(Math.min(1_000, end - now()), signal)
        }
      }
    }

    async function remember(owner: Owner, watch: Watch, value: Handle, hooks: Hooks) {
      if (
        !matches(
          {
            providerId: watch.intent.providerId,
            invocationId: watch.intent.invocationId,
            browserTaskId: watch.intent.browserTaskId,
          },
          value,
        )
      )
        throw failure("invalid_response")
      if (watch.handle && !matches(watch.handle, value)) throw failure("invalid_response")
      watch.handle = await owner.remember({
        providerId: value.providerId,
        browserTaskId: value.browserTaskId,
        jobId: value.jobId,
        invocationId: value.invocationId,
      })
      await hooks.metadata({
        ...ids(value),
        status: "accepted",
        reason: "accepted",
        summary: "Browser task accepted.",
        evidence: [],
        effectsUncertain: false,
      })
    }

    async function lookup(owner: Owner, watch: Watch, hooks: Hooks, end: number) {
      const response = await retry(
        () =>
          request(
            { operation: "recover", owner: authority(owner), invocationId: watch.intent.invocationId },
            hooks.signal,
            end,
            watch,
          ),
        hooks.signal,
        end,
      )
      if (response.kind === "not_found" && response.invocationId === watch.intent.invocationId) return undefined
      if (response.kind !== "recovered") throw failure("invalid_response")
      verify(watch.intent, response.job)
      await remember(owner, watch, response.job, hooks)
      watch.latest = response.job
      watch.lost = undefined
      return response.job
    }

    function interrupted(watch: Watch, err: Failure = failure("delivery_interrupted", true)): Output {
      return { ...rejected(err), ...ids(watch.handle ?? watch.intent), guidance: recovery }
    }

    function release(watch: Watch) {
      watches.delete(watch)
      for (const [id, route] of routes) if (route === watch) routes.delete(id)
    }

    async function wait(owner: Owner, watch: Watch, hooks: Hooks, bound?: number): Promise<Output> {
      let next = 0
      let deadline = now() + 30_000
      while (true) {
        check(hooks.signal)
        const latest = watch.latest
        watch.latest = undefined
        if (latest) {
          const value = output(latest)
          await hooks.metadata(value)
          if (RemoteProtocol.BrowserTerminalStatus.safeParse(latest.status).success) return value
          if ("deadlines" in latest)
            deadline =
              Date.parse(latest.deadlines.execution ?? latest.deadlines.approval ?? latest.deadlines.queue) + 30_000
        }
        const end = Math.min(bound ?? Infinity, deadline, (watch.lost ?? now()) + 30_000)
        if (now() >= end) return interrupted(watch)
        if (now() < next) {
          await pause(Math.min(next, end) - now(), hooks.signal, true)
          continue
        }
        const handle = watch.handle
        if (!handle) throw failure("invalid_response")
        const started = now()
        next = started + 1_000
        try {
          const response = await request(
            { operation: "status", owner: authority(owner), browserTaskId: handle.browserTaskId, jobId: handle.jobId },
            hooks.signal,
            end,
            watch,
          )
          if (response.kind !== "status") throw failure("invalid_response")
          verify({ ...watch.intent, handle }, response.job)
          // A terminal event received during this status request wins over older progress.
          if (!watch.latest || !terminal(watch.latest)) watch.latest = response.job
          watch.lost = undefined
        } catch (err) {
          if (!(err instanceof Error) || err.data.code !== "delivery_interrupted") throw err
          watch.lost ??= started
        }
      }
    }

    async function stop(owner: Owner, watch: Watch, hooks: Hooks): Promise<Output> {
      const end = now() + 10_000
      const stopping = { ...hooks, signal: new AbortController().signal }
      try {
        if (!watch.handle && !(await lookup(owner, watch, stopping, end))) {
          return { ...rejected(failure("cancelled")), ...ids(watch.intent), status: "cancelled" }
        }
        const handle = watch.handle
        if (!handle) throw failure("invalid_response")
        const response = await request(
          { operation: "cancel", owner: authority(owner), browserTaskId: handle.browserTaskId, jobId: handle.jobId },
          stopping.signal,
          end,
          watch,
        )
        if (response.kind !== "ack" || response.operation !== "cancel" || !matches(handle, response))
          throw failure("invalid_response")
        return await wait(owner, watch, stopping, end)
      } catch (err) {
        if (!(err instanceof Error)) throw err
        return {
          ...interrupted(watch),
          summary: "Cancellation could not be confirmed. Issued browser actions are not undone. " + recovery,
        }
      }
    }

    async function recover(owner: Owner, hooks: Hooks, records?: Intent[]): Promise<Output> {
      const retained = records ?? (await owner.recover())
      const end = now() + 30_000
      const jobs: Output[] = []
      for (const intent of retained) {
        const watch: Watch = { intent, handle: intent.handle }
        watches.add(watch)
        try {
          const job = await lookup(owner, watch, hooks, end)
          jobs.push(
            job
              ? output(job)
              : {
                  ...ids(intent),
                  status: "not_found",
                  reason: "not_found",
                  summary:
                    "The relay has no accepted job for this retained intent. " +
                    "Only the original trusted call can retry its unchanged goal and invocation. " +
                    "Use an explicit operation=run with provider_id for a new goal; this intent will not replay.",
                  evidence: [],
                  effectsUncertain: false,
                },
          )
        } catch (err) {
          if (!(err instanceof Error)) throw err
          if (err.data.code === "cancelled") throw err
          jobs.push({ ...rejected(err), ...ids(watch.handle ?? intent), guidance: recovery })
        } finally {
          release(watch)
        }
      }
      return {
        status: jobs.length ? "recovered" : "empty",
        reason: jobs.length ? "status_recovery" : "no_retained_intents",
        summary: jobs.length
          ? "Retrieved retained browser intents without dispatching work."
          : "This parent has no retained browser intent to recover.",
        ...(!jobs.length
          ? {
              guidance:
                "Use browser_task with operation=list to discover providers, then explicitly call operation=run with provider_id and a new goal.",
            }
          : {}),
        evidence: [],
        effectsUncertain: jobs.some((job) => job.effectsUncertain),
        jobs,
      }
    }

    async function run(owner: Owner, input: Parameters<Owner["prepare"]>[0], hooks: Hooks): Promise<Output> {
      const records = await owner.recover()
      const unresolved = records.filter((record) => !record.handle && record.invocationId !== owner.invocationId)
      if (unresolved.length) {
        const result = await recover(owner, hooks, unresolved)
        // Recheck on each explicit call; only authoritative not-found permits this new goal, never prior-intent replay.
        if (!result.jobs?.every((job) => job.status === "not_found"))
          return {
            ...result,
            status: "recovery_required",
            summary:
              "Resolved or surfaced earlier unacknowledged intents before any new submission. Review their status before an explicit new run.",
            guidance: recovery,
          }
      }
      const saved = records.find((record) => record.invocationId === owner.invocationId)
      const intent = await owner.prepare(input)
      const watch: Watch = { intent, handle: saved?.handle }
      watches.add(watch)
      const end = now() + 30_000
      try {
        if (saved) await lookup(owner, watch, hooks, end)
        while (!watch.handle) {
          check(hooks.signal)
          try {
            const response = await request(
              { operation: "invoke", owner: authority(owner), invocationId: intent.invocationId, ...input },
              hooks.signal,
              end,
              watch,
            )
            if (response.kind !== "ack" || response.operation !== "invoke") throw failure("invalid_response")
            await remember(owner, watch, response, hooks)
          } catch (err) {
            if (!(err instanceof Error) || err.data.code !== "delivery_interrupted") throw err
            // Only authoritative not-found permits another send of this exact stored invocation and payload.
            if (await lookup(owner, watch, hooks, end)) break
            await pause(Math.min(1_000, Math.max(0, end - now())), hooks.signal)
          }
          if (!watch.handle && now() >= end) return interrupted(watch)
        }
        return await wait(owner, watch, hooks)
      } catch (err) {
        if (hooks.signal.aborted) return await stop(owner, watch, hooks)
        if (err instanceof Error && err.data.code === "delivery_interrupted") return interrupted(watch)
        throw err
      } finally {
        release(watch)
      }
    }

    async function status(
      owner: Owner,
      task: Handle["browserTaskId"],
      job: Handle["jobId"] | undefined,
      hooks: Hooks,
      cancel = false,
    ): Promise<Output> {
      const owned = await owner.lookup(task, job)
      const end = now() + 30_000
      const response = await retry(
        () =>
          request({ operation: "status", owner: authority(owner), browserTaskId: task, jobId: job }, hooks.signal, end),
        hooks.signal,
        end,
      ).catch((err: unknown) => {
        if (err instanceof Error && err.data.code === "delivery_interrupted") return err
        throw err
      })
      if (response instanceof Error) return { ...rejected(response), ...ids(owned) }
      if (response.kind !== "status" || !matches(owned, response.job)) throw failure("invalid_response")
      const intent = (await owner.recover()).find((record) => record.invocationId === response.job.invocationId)
      if (!intent) throw failure("invalid_response")
      verify(intent, response.job)
      await hooks.metadata(output(response.job))
      if (!cancel || response.job.result) return output(response.job)
      const watch: Watch = { intent, handle: intent.handle, latest: response.job }
      watches.add(watch)
      try {
        return await stop(owner, watch, hooks)
      } finally {
        release(watch)
      }
    }

    return {
      run,
      recover,
      status,
      async list(signal: AbortSignal): Promise<Output> {
        const providers: NonNullable<Output["providers"]> = []
        const cursors = new Set<string>()
        const end = now() + 30_000
        let cursor: Handle["providerId"] | undefined
        do {
          const response = await retry(() => request({ operation: "list", cursor }, signal, end), signal, end)
          if (response.kind !== "providers") throw failure("invalid_response")
          providers.push(...response.providers)
          cursor = response.nextCursor
          if (cursor && cursors.has(cursor)) throw failure("invalid_response")
          if (cursor) cursors.add(cursor)
        } while (cursor)
        return {
          status: providers.length ? "available" : "empty",
          reason: providers.length ? "providers" : "no_enabled_providers",
          summary: providers.length
            ? "Choose an explicit provider_id for every run or continuation."
            : "No enabled browser provider is available. " + panel,
          evidence: [],
          effectsUncertain: false,
          providers,
        }
      },
      open() {
        state = "pending"
        wake()
        void connection()
          .heartbeat()
          .catch(() => {
            if (state !== "closed") wake()
          })
      },
      disconnect() {
        state = "pending"
        for (const watch of watches) watch.lost ??= now()
        for (const waiter of pending.values()) waiter.reject(failure("delivery_interrupted", true))
        routes.clear()
        wake()
      },
      close() {
        state = "closed"
        for (const waiter of pending.values()) waiter.reject(failure("delivery_interrupted", true))
        routes.clear()
        wake()
      },
      handle(message: RemoteProtocol.HeartbeatAck | RemoteProtocol.BrowserResponse | RemoteProtocol.BrowserEvent) {
        if (state === "closed") return
        if (message.type === "heartbeat_ack") {
          // Old relays omit this capability; fail closed until every old relay retires.
          state = RemoteProtocol.NormalizedBrowserCapabilities.parse(message.capabilities).browserJobsV1
            ? "ready"
            : "unsupported"
          wake()
          return
        }
        if (state !== "ready") return
        if (message.type === "browser_response") {
          pending.get(message.requestId)?.resolve(message.response)
          return
        }
        const watch = routes.get(message.requestId)
        const update = message.event === "progress" ? message.job : message.result
        if (!watch?.handle || !matches(watch.handle, update)) return
        if (watch.latest && terminal(watch.latest)) return
        watch.latest = update
        wake()
      },
    }
  }
}
