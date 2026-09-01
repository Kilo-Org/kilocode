import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  onMount,
  useContext,
} from "solid-js"
import type { ParentComponent } from "solid-js"
import { useSession } from "./session"
import { useVSCode } from "./vscode"
import type { BackgroundJobInfo } from "../types/messages"
import {
  backgroundAgents,
  backgroundJobAgents,
  showBackgroundAgent,
  type BackgroundAgent,
} from "../components/chat/background-agents"

function create() {
  const session = useSession()
  const vscode = useVSCode()
  const [jobs, setJobs] = createSignal<BackgroundJobInfo[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [mounted, setMounted] = createSignal(false)
  const [open, setOpen] = createSignal(false)
  const [focus, setFocus] = createSignal(0)
  const target = createUniqueId()
  const reveal = () => {
    setOpen(true)
    setFocus((value) => value + 1)
  }
  let pending: string | undefined
  let revision = 0

  const request = () => {
    const id = session.currentSessionID()
    if (!id || pending) return
    pending = `${id}:${++revision}`
    vscode.postMessage({ type: "requestBackgroundJobs", sessionID: id, requestID: pending })
  }

  createEffect(
    on(session.currentSessionID, () => {
      setOpen(false)
      setLoaded(false)
      setJobs([])
      pending = undefined
      if (mounted()) request()
    }),
  )

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "backgroundJobsLoaded") return
    if (message.sessionID !== session.currentSessionID() || message.requestID !== pending) return
    pending = undefined
    if (message.error) {
      setLoaded(false)
      return
    }
    setJobs(message.jobs)
    setLoaded(true)
  })
  onCleanup(unsubscribe)

  onMount(() => {
    setMounted(true)
    request()
    const timer = setInterval(request, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const agents = createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return []
    if (loaded()) return backgroundJobAgents(jobs(), id, session.scopedPermissions(id), session.scopedQuestions(id))
    return backgroundAgents(session.getSessionToolParts(id), session.allStatusMap())
  })
  const visible = createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return []
    const hidden = session.dismissedBackgroundJobs(id)
    return agents().filter((agent) => showBackgroundAgent(agent, hidden))
  })
  const active = createMemo(() =>
    visible().filter((agent) => agent.status === "running" || agent.permission || agent.question),
  )
  const waiting = createMemo(() => active().filter((agent) => agent.permission || agent.question).length)

  const cancel = (agent: BackgroundAgent) => {
    if (agent.status !== "running") return
    const id = session.currentSessionID()
    if (!id) return
    pending = `${id}:${++revision}`
    vscode.postMessage({ type: "cancelBackgroundJob", jobID: agent.jobID, sessionID: id, requestID: pending })
  }
  const hide = (ids: string[]) => {
    const id = session.currentSessionID()
    if (id) session.dismissBackgroundJobs(id, ids)
  }
  const clear = () =>
    hide(
      agents()
        .filter((agent) => agent.status !== "running")
        .map((agent) => agent.jobID),
    )

  return { visible, active, waiting, cancel, hide, clear, open, setOpen, focus, target, reveal }
}

const Context = createContext<ReturnType<typeof create>>()

export const BackgroundAgentsProvider: ParentComponent = (props) => (
  <Context.Provider value={create()}>{props.children}</Context.Provider>
)

export function useBackgroundAgents() {
  const context = useContext(Context)
  if (!context) throw new Error("useBackgroundAgents must be used within a BackgroundAgentsProvider")
  return context
}
