/**
 * Background job list of the current session.
 *
 * One poller per chat view asks the extension for the job list every second.
 * Readers only listen to the replies, so the dock stack, the Stop tooltip, and
 * the swarm board share one request stream.
 */

import { createComputed, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import type { BackgroundJobInfo } from "../../types/messages"
import { backgroundAgents, backgroundJobAgents, showBackgroundAgent, type BackgroundAgent } from "./background-agents"

/** Polls the job list of the current session while the view is mounted. */
export function pollBackgroundJobs() {
  const session = useSession()
  const vscode = useVSCode()
  let pending: string | undefined
  let revision = 0

  const request = () => {
    const id = session.currentSessionID()
    if (!id || pending) return
    pending = `${id}:${++revision}`
    vscode.postMessage({ type: "requestBackgroundJobs", sessionID: id, requestID: pending })
  }

  createEffect(
    on(
      session.currentSessionID,
      () => {
        pending = undefined
        request()
      },
      { defer: true },
    ),
  )

  onMount(() => {
    const unsub = vscode.onMessage((message) => {
      if (message.type === "backgroundJobsLoaded" && message.requestID === pending) pending = undefined
    })
    request()
    const timer = setInterval(request, 1000)
    onCleanup(() => {
      unsub()
      clearInterval(timer)
    })
  })
}

/**
 * The background agents of the current session that are not dismissed.
 *
 * Job status is the source of truth. Child session status is the fallback
 * until a reply arrives or after a failed one, because a webview does not
 * always receive status for every child session.
 */
export function useBackgroundAgents() {
  const session = useSession()
  const vscode = useVSCode()
  const [jobs, setJobs] = createSignal<BackgroundJobInfo[]>()
  createEffect(on(session.currentSessionID, () => setJobs(undefined), { defer: true }))
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "backgroundJobsLoaded") return
      if (message.sessionID !== session.currentSessionID()) return
      setJobs(message.error ? undefined : message.jobs)
    }),
  )
  const next = createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return []
    const list = jobs()
    if (!list) return backgroundAgents(session.getSessionToolParts(id), session.allStatusMap())
    const hidden = session.dismissedBackgroundJobs(id)
    return backgroundJobAgents(list, id, session.scopedPermissions(id), session.scopedQuestions(id)).filter((agent) =>
      showBackgroundAgent(agent, hidden),
    )
  })
  // Every poll reply builds new agent objects. Reconciling by ID keeps each
  // agent the same object while it exists, so lists keyed by reference keep
  // their rows, and a row changes only the fields that changed. Without
  // this, every reply would rebuild each row and restart its animations.
  const [store, setStore] = createStore<{ list: BackgroundAgent[] }>({ list: [] })
  createComputed(() => setStore("list", reconcile(next(), { key: "id" })))
  return () => store.list
}
