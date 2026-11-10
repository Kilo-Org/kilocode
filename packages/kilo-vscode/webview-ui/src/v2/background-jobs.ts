// The subagent jobs of the open session, on the `kilocode.background-jobs` RPC. A session switch or a reconnect lists
// them once; `changed` events keep the list current. A subagent part that names a child the list does not know lists
// again, so a missed event cannot hide an agent. Cleared finished agents stay hidden for the life of the view.
import type { SessionMessageInfo } from "@opencode/client"
import { KiloBackgroundJobsRpc } from "@opencode/schema/kilocode/background-jobs"
import { createComputed, createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { showToast } from "@kilocode/kilo-ui/toast"
import {
  jobAgents,
  mergeListed,
  runChildren,
  showBackgroundAgent,
  transcriptAgents,
  transcriptChildren,
  upsertJob,
  type BackgroundAgent,
  type BackgroundJob,
} from "../components/chat/background-agents"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"

const EMPTY: readonly SessionMessageInfo[] = []

function errorType(error: unknown) {
  if (error && typeof error === "object" && "type" in error && typeof error.type === "string") return error.type
  return undefined
}

export function createBackgroundJobs(input: { session: Accessor<string | undefined> }) {
  const v2 = useV2()
  const language = useLanguage()
  const rpc = v2.api.rpc(KiloBackgroundJobsRpc.Definition)
  const location = { directory: v2.directory }
  // Undefined until the first list answer for the open session, and on a server without the plugin.
  const [jobs, setJobs] = createSignal<BackgroundJob[]>()
  const [hidden, setHidden] = createSignal<Record<string, ReadonlySet<string>>>({})
  let reads = 0
  let touched = new Set<string>()
  let unsupported = false

  const messages = () => {
    const id = input.session()
    return id ? v2.data.session.message.list(id) : EMPTY
  }

  const list = (sessionID: string) => {
    if (unsupported) return
    const token = ++reads
    touched = new Set()
    void rpc
      .list({ sessionID }, { location })
      .then((value) => {
        if (token !== reads || input.session() !== sessionID) return
        setJobs((current) => mergeListed(value.jobs, current ?? [], touched))
      })
      .catch((error: unknown) => {
        // The transcript stands in: a server without the plugin, or a new session the server does not have yet.
        if (errorType(error) === "rpc.unavailable") unsupported = true
      })
  }

  onCleanup(
    rpc.events.on("changed", (event) => {
      if (event.data.parentSessionID !== input.session()) return
      touched.add(event.data.job.id)
      setJobs((current) => upsertJob(current ?? [], event.data.job))
    }),
  )

  createEffect(
    on(
      () => [input.session(), v2.connection.status()] as const,
      ([id, status], previous) => {
        if (id !== previous?.[0]) setJobs(undefined)
        // A server that answered without the plugin may have it after a reconnect, for example once it registered.
        if (id !== previous?.[0] || (status === "connected" && previous?.[1] !== "connected")) unsupported = false
        if (!id || status !== "connected") return
        list(id)
      },
    ),
  )

  createEffect(
    on(
      () => transcriptChildren(messages()).join(),
      (key) => {
        const id = input.session()
        const known = new Set<string>((jobs() ?? []).map((job) => job.sessionID))
        if (!id || !key || v2.connection.status() !== "connected") return
        if (key.split(",").every((child) => known.has(child))) return
        list(id)
      },
      { defer: true },
    ),
  )

  const waiting = (sessionID: string) =>
    (v2.data.session.permission.list(sessionID)?.length ?? 0) > 0 ||
    (v2.data.session.form.list(sessionID)?.length ?? 0) > 0
  const running = (sessionID: string) => v2.data.session.status(sessionID) === "running"

  const next = createMemo(() => {
    const id = input.session()
    if (!id) return []
    const list = jobs()
    if (!list) return transcriptAgents(messages(), running, waiting)
    const hide = hidden()[id] ?? new Set<string>()
    return jobAgents(list, id, waiting).filter((agent) => showBackgroundAgent(agent, hide))
  })
  // Each event and list answer builds new agent objects. Reconciling by ID keeps each agent the same object while it
  // exists, so lists keyed by reference keep their rows and their animations.
  const [store, setStore] = createStore<{ list: BackgroundAgent[] }>({ list: [] })
  createComputed(() => setStore("list", reconcile(next(), { key: "id" })))

  const report = (error: unknown) => {
    if (errorType(error) === "not_found") return
    v2.report(error)
  }

  return {
    /** The background agents of the open session that the user did not clear. */
    agents: () => store.list,
    /** Every job of the open session, foreground ones included. */
    jobs: () => jobs() ?? [],
    job: (sessionID: string) => jobs()?.find((job) => job.sessionID === sessionID),
    /** The latest user message: the start of the current run. */
    boundary: createMemo(() => messages().findLast((message) => message.type === "user")?.id),
    /** The child sessions the current run started. */
    started: createMemo(() => new Set(runChildren(messages()))),
    /** Stop one subagent, its child session and every session the child started. */
    cancel: (sessionID: string) => {
      void rpc.cancel({ jobID: sessionID }, { location }).catch((error: unknown) => {
        const type = errorType(error)
        // Without a job, stop the child session itself.
        if (type === "not_found" || type === "rpc.unavailable")
          return v2.api.session.interrupt({ sessionID }).catch(v2.report)
        v2.report(error)
      })
    },
    /** Continue a running foreground subagent in the background. */
    promote: (sessionID: string) => {
      void rpc
        .promote({ jobID: sessionID }, { location })
        .then((moved) => {
          // The job finished, or core could not background it: the card keeps waiting, so say why.
          if (moved) return
          showToast({
            variant: "error",
            title: language.t("common.requestFailed"),
            description: language.t("task.backgroundAgents.promoteFailed"),
          })
        })
        .catch(report)
    },
    /** Hide finished agents of the open session. */
    dismiss: (ids: string[]) => {
      const id = input.session()
      if (!id) return
      setHidden((current) => ({ ...current, [id]: new Set([...(current[id] ?? []), ...ids]) }))
    },
  }
}

export type BackgroundJobs = ReturnType<typeof createBackgroundJobs>
