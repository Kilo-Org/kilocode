import { createSignal } from "solid-js"
import {
  equalCloudSummary,
  mergeCloudSummaries,
  pickCloudSummary,
  replaceCloudSummary,
  toCloudSummary,
  type CloudSummaryVersion,
} from "../../../src/shared/cloud-session-summary"
import type { ExtensionMessage, SessionInfo, WebviewMessage } from "../../src/types/messages"
import { closeCloudTab, openCloudTab } from "./tab-state"
import { LOCAL } from "../navigate"
import { reorderTabs } from "../tab-order"

export const CLOUD = "cloud-agent"

type CloudCreateContext = Pick<
  Extract<ExtensionMessage, { type: "agentManager.cloudCreateContext" }>,
  "status" | "repository" | "account" | "error"
>

type CloudCreateInput = Omit<Extract<WebviewMessage, { type: "agentManager.createCloudSession" }>, "type">

const BLOCKED_ACTIONS = new Set([
  "sessionPrevious",
  "sessionNext",
  "showTerminal",
  "toggleDiff",
  "newTab",
  "newWorktree",
  "openWorktree",
  "runScript",
  "advancedWorktree",
  "closeWorktree",
  "newTerminal",
])

export function blocksCloudAction(action?: string) {
  return !!action && (BLOCKED_ACTIONS.has(action) || /^jumpTo[1-9]$/.test(action))
}

interface CloudSession {
  currentSessionID: () => string | undefined
  sessions: () => SessionInfo[]
  selectSession: (id: string) => void
  clearCurrentSession: () => void
  attachCloudSession: (session: SessionInfo) => void
  detachCloudSession: (id: string) => void
}

interface CloudSessionStateOptions {
  session: CloudSession
  enabled: boolean
  postMessage: (message: WebviewMessage) => void
  setSelection: (selection: string) => void
  prepare: () => void
}

export function createCloudSessionState(opts: CloudSessionStateOptions) {
  const [enabled, setEnabled] = createSignal(opts.enabled)
  const [sessions, setSessions] = createSignal<SessionInfo[]>([])
  const [status, setStatus] = createSignal<"loading" | "ready" | "error" | "signed-out">("loading")
  const [repository, setRepository] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const [collapsed, setCollapsed] = createSignal(false)
  const [context, setContext] = createSignal<CloudCreateContext>({ status: "loading" })
  const [creating, setCreating] = createSignal(false)
  const [createError, setCreateError] = createSignal<string>()
  const [success, setSuccess] = createSignal(0)
  const [ids, setIds] = createSignal<string[]>([])
  const observed = new Map<string, CloudSummaryVersion>()
  const set = () => new Set(ids())
  const tabs = () => {
    const lookup = new Map(opts.session.sessions().map((item) => [item.id, item]))
    return ids().flatMap((id) => lookup.get(id) ?? [])
  }

  const update = (items: SessionInfo[]) => {
    const lookup = new Map(items.map((item) => [item.id, item]))
    for (const id of ids()) {
      const item = lookup.get(id)
      if (item) opts.session.attachCloudSession(item)
    }
  }

  const fallback = (next: string[], selected?: string) => {
    const id = selected ?? next[0]
    if (id) {
      opts.session.selectSession(id)
      return
    }
    opts.setSelection(LOCAL)
    opts.session.clearCurrentSession()
  }

  const close = (id: string, notify = true) => {
    const previous = ids()
    const next = closeCloudTab(previous, id)
    if (next.ids === previous) return
    const active = opts.session.currentSessionID() === id
    setIds(next.ids)
    if (notify) opts.postMessage({ type: "agentManager.closeCloudSession", sessionId: id })
    opts.session.detachCloudSession(id)
    if (active) fallback(next.ids, next.selected)
  }

  const open = (info: SessionInfo) => {
    opts.prepare()
    opts.setSelection(CLOUD)
    const exists = set().has(info.id)
    setIds((prev) => openCloudTab(prev, info.id))
    opts.session.attachCloudSession(info)
    if (!exists) opts.postMessage({ type: "agentManager.openCloudSession", sessionId: info.id })
    opts.session.selectSession(info.id)
  }

  const create = (input: CloudCreateInput) => {
    if (creating()) return
    setCreating(true)
    setCreateError(undefined)
    opts.postMessage({ type: "agentManager.createCloudSession", ...input })
  }

  const request = () => opts.postMessage({ type: "agentManager.requestCloudSessions" })

  const disable = () => {
    setEnabled(false)
    for (const id of ids()) close(id)
    observed.clear()
    setSessions([])
    setStatus("loading")
    setRepository(undefined)
    setError(undefined)
    setContext({ status: "loading" })
    setCreating(false)
    setCreateError(undefined)
  }

  const enable = (value: boolean, close: () => void = () => {}) => {
    if (value === enabled()) return
    setEnabled(value)
    if (value) return request()
    close()
    disable()
  }

  const handle = (msg: ExtensionMessage) => {
    if (!enabled()) return
    if (msg.type === "agentManager.cloudSessions") {
      const versions = mergeCloudSummaries(msg.sessions.map(toCloudSummary), observed)
      observed.clear()
      for (const version of versions) observed.set(version.value.id, version)
      const next = versions.map((version) => version.value)
      setStatus(msg.status)
      setSessions(next)
      setRepository(msg.repository)
      setError(msg.error)
      if (msg.status === "ready") update(next)
      return
    }
    if (msg.type === "sessionUpdated") {
      const current = sessions()
      const index = current.findIndex((session) => session.id === msg.session.id)
      if (index < 0) return
      const previous = observed.get(msg.session.id) ?? {
        value: toCloudSummary(current[index]),
        source: "list" as const,
      }
      const next: CloudSummaryVersion = { value: toCloudSummary(msg.session), source: "event" }
      if (pickCloudSummary(previous, next) !== next) return
      observed.set(next.value.id, next)
      if (!equalCloudSummary(previous.value, next.value))
        setSessions(replaceCloudSummary(current.map(toCloudSummary), next.value))
      return
    }
    if (msg.type === "agentManager.cloudCreateContext") {
      setContext({ status: msg.status, repository: msg.repository, account: msg.account, error: msg.error })
      return
    }
    if (msg.type === "agentManager.cloudSessionCreated") {
      setCreating(false)
      setCreateError(undefined)
      open(msg.session)
      setSuccess((value) => value + 1)
      return
    }
    if (msg.type === "agentManager.cloudSessionCreateFailed") {
      setCreating(false)
      setCreateError(msg.error)
      return
    }
    if (msg.type === "agentManager.cloudSessionDeleted") close(msg.sessionId)
  }

  return {
    enabled,
    enable,
    sessions,
    visible: () => (status() === "signed-out" ? [] : sessions()),
    status,
    repository,
    error,
    collapsed,
    toggle: () => setCollapsed((value) => !value),
    request,
    retry: () => opts.postMessage({ type: "agentManager.retryCloudSessions" }),
    context,
    creating,
    createError,
    success,
    requestCreateContext: () => {
      setContext({ status: "loading" })
      setCreateError(undefined)
      opts.postMessage({ type: "agentManager.requestCloudCreateContext" })
    },
    create,
    disable,
    ids,
    reorder: (from: string, to: string) => {
      const next = reorderTabs(ids(), from, to)
      if (next) setIds(next)
    },
    set,
    tabs,
    isTab: (id = opts.session.currentSessionID()) => !!id && set().has(id),
    open,
    close,
    handle,
  }
}
