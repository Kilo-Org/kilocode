/**
 * The message handlers of the Agent Manager app, one small function per message group. The app keeps the effects and
 * the JSX; these functions only apply a host message to the app state they were given.
 */
import type { Accessor } from "solid-js"
import type {
  AgentManagerImportResultMessage,
  AgentManagerKeybindingsMessage,
  AgentManagerMultiVersionProgressMessage,
  AgentManagerRepoInfoMessage,
  AgentManagerRevealSessionMessage,
  AgentManagerSendInitialMessage,
  AgentManagerSessionAddedMessage,
  AgentManagerSessionForkedMessage,
  AgentManagerWorktreeSetupMessage,
  ManagedSessionState,
  SessionInfo,
} from "../src/types/messages/agent-manager"
import type { SetupState } from "./project/progress"
import { clearMultiVersionBusy, markMultiVersionBusy, updateSetup } from "./project/progress"
import { isCurrent } from "./project/message-ownership"
import type { ProjectStore } from "./project/store"

export function applyRepoInfo(
  msg: AgentManagerRepoInfoMessage,
  setBranches: (update: (prev: Record<string, string | undefined>) => Record<string, string | undefined>) => void,
) {
  setBranches((prev) => ({ ...prev, [msg.projectId ?? "single"]: msg.defaultBranch }))
}

export function applySetupMessage(
  msg: AgentManagerWorktreeSetupMessage,
  deps: {
    setup: () => SetupState
    setSetup: (state: SetupState | ((prev: SetupState) => SetupState)) => void
    creation: { setup: (msg: AgentManagerWorktreeSetupMessage) => void }
    ensure: (projectId: string) => ProjectStore
    active: () => ProjectStore
    currentProjectId: Accessor<string | undefined>
    selection: Accessor<string | null>
    isActivePayload: (projectId: string | undefined) => boolean
    setSelection: (id: string) => void
    setReviewActive: (open: boolean) => void
    selectSession: (id: string) => void
    managedSessions: () => ManagedSessionState[]
    evictLocal: (id: string) => void
    requestChatFocus: (force?: boolean) => void
  },
) {
  deps.creation.setup(msg)
  const store = msg.projectId ? deps.ensure(msg.projectId) : deps.active()
  const previous = deps.setup()
  const next = updateSetup(store, previous, msg, deps.currentProjectId(), deps.selection())
  if (next !== previous) {
    deps.setSetup(next)
    if (next.active && next.error)
      globalThis.setTimeout(
        () => deps.setSetup((current) => (current === next ? { active: false, message: "" } : current)),
        3000,
      )
  }
  if (!deps.isActivePayload(msg.projectId)) return
  if (msg.status === "ready" && msg.sessionId) {
    deps.selectSession(msg.sessionId)
    const managed = deps.managedSessions().find((session) => session.id === msg.sessionId)
    if (managed?.worktreeId) deps.setSelection(managed.worktreeId)
    deps.evictLocal(msg.sessionId)
    deps.requestChatFocus(true)
    return
  }
  if (msg.status !== "ready" && msg.status !== "error") {
    if (msg.worktreeId) deps.setSelection(msg.worktreeId)
    deps.setReviewActive(false)
  }
}

export function applySessionAdded(msg: AgentManagerSessionAddedMessage, deps: {
  currentProjectId: Accessor<string | undefined>
  saveTabMemory: () => void
  appendOrder: (worktreeId: string, sessionId: string) => void
  setSelection: (id: string) => void
  evictLocal: (id: string) => void
  applyDraft: (worktreeId: string, sessionId: string) => void
  selectSession: (id: string) => void
  requestChatFocus: (force?: boolean) => void
}) {
  if (!isCurrent(msg, deps.currentProjectId())) return
  deps.saveTabMemory()
  deps.appendOrder(msg.worktreeId, msg.sessionId)
  deps.setSelection(msg.worktreeId)
  deps.evictLocal(msg.sessionId)
  deps.applyDraft(msg.worktreeId, msg.sessionId)
  deps.selectSession(msg.sessionId)
  deps.requestChatFocus(true)
}

export function applySessionForked(msg: AgentManagerSessionForkedMessage, deps: {
  currentProjectId: Accessor<string | undefined>
  insertAfter: (worktreeId: string | undefined, anchor: string, id: string) => void
  setLocal: (update: (prev: string[]) => string[]) => void
  persist: (sessionId: string) => void
  saveTabMemory: () => void
  setSelection: (id: string) => void
  evictLocal: (id: string) => void
  selectSession: (id: string) => void
  remember: (session: SessionInfo) => void
  requestChatFocus: (force?: boolean) => void
}) {
  if (!isCurrent(msg, deps.currentProjectId())) return
  deps.remember(msg.session)
  deps.insertAfter(msg.worktreeId, msg.forkedFromId, msg.sessionId)
  if (!msg.worktreeId) {
    deps.setLocal((prev) => {
      const index = prev.indexOf(msg.forkedFromId)
      if (index >= 0) return [...prev.slice(0, index + 1), msg.sessionId, ...prev.slice(index + 1)]
      return [...prev, msg.sessionId]
    })
    deps.persist(msg.sessionId)
  } else {
    deps.saveTabMemory()
    deps.setSelection(msg.worktreeId)
    deps.evictLocal(msg.sessionId)
  }
  deps.selectSession(msg.sessionId)
  deps.requestChatFocus(true)
}

export function applyRevealSession(msg: AgentManagerRevealSessionMessage, deps: {
  currentProjectId: Accessor<string | undefined>
  focusManaged: (worktreeId: string, sessionId: string, scroll: boolean) => void
  focusLocal: (sessionId: string, scroll: boolean) => void
}) {
  if (deps.currentProjectId() !== msg.projectId) return
  if (msg.worktreeId) deps.focusManaged(msg.worktreeId, msg.sessionId, true)
  else deps.focusLocal(msg.sessionId, true)
}

export function applyKeybindings(msg: AgentManagerKeybindingsMessage, set: (value: Record<string, string>) => void) {
  set(msg.bindings)
}

export function applyMultiVersion(
  msg: AgentManagerMultiVersionProgressMessage,
  deps: { creation: { abandon: (projectId?: string) => void }; ensure: (projectId: string) => ProjectStore; active: () => ProjectStore },
) {
  if (msg.status === "done") deps.creation.abandon(msg.projectId)
  if (msg.status === "done" && msg.groupId) {
    clearMultiVersionBusy(msg.projectId ? deps.ensure(msg.projectId) : deps.active(), msg.groupId)
  }
}

export function applyMultiVersionReady(
  msg: AgentManagerWorktreeSetupMessage,
  deps: { ensure: (projectId: string) => ProjectStore; active: () => ProjectStore },
) {
  if (msg.status === "ready" && msg.sessionId) {
    markMultiVersionBusy(msg.projectId ? deps.ensure(msg.projectId) : deps.active(), msg.sessionId)
  }
}

export function applySendInitial(
  ev: AgentManagerSendInitialMessage,
  deps: {
    sendInitial: (ev: AgentManagerSendInitialMessage) => Promise<void>
    clearBusy: (projectId: string | undefined, worktreeId: string) => void
  },
) {
  void deps.sendInitial(ev)
  if (ev.worktreeId) deps.clearBusy(ev.projectId, ev.worktreeId)
}

export function applyImportResult(msg: AgentManagerImportResultMessage, converge: (projectId?: string) => void) {
  if (!msg.success) converge(msg.projectId)
}

/** A failed worktree delete leaves the worktree marked busy; the failure message clears it. */
export function clearFailedDelete(
  msg: { type: string; code?: string; worktreeId?: string; projectId?: string },
  stores: { ensure: (projectId: string) => ProjectStore; active: () => ProjectStore },
): void {
  if (msg.type !== "error" || msg.code !== "agentManager.worktreeDeleteFailed" || !msg.worktreeId) return
  const store = msg.projectId ? stores.ensure(msg.projectId) : stores.active()
  store.setBusy((prev) => new Map([...prev].filter(([id]) => id !== msg.worktreeId)))
}
