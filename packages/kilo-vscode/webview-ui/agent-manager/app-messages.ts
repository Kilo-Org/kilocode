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
import type { QuickCreate } from "./quick-create"
import { LOCAL } from "./navigate"
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
    /** A quick create in flight, which has no dialog to explain a setup blocker. */
    quick?: QuickCreate
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
    saveTabMemory: () => void
  },
) {
  if (quickCreateBlocked(msg, deps.quick)) return
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
  // The new worktree takes the selection: the context it leaves remembers its tab before the new session replaces a
  // main terminal tab (the main surface drops the terminal once a session becomes the current one).
  const leave = (worktree: string | null | undefined) => {
    if (worktree && deps.selection() !== worktree) deps.saveTabMemory()
  }
  if (msg.status === "ready" && msg.sessionId) {
    const worktree = msg.worktreeId ?? deps.managedSessions().find((session) => session.id === msg.sessionId)?.worktreeId
    leave(worktree)
    deps.selectSession(msg.sessionId)
    if (worktree) deps.setSelection(worktree)
    deps.evictLocal(msg.sessionId)
    deps.requestChatFocus(true)
    return
  }
  if (msg.status !== "ready" && msg.status !== "error") {
    leave(msg.worktreeId)
    if (msg.worktreeId) deps.setSelection(msg.worktreeId)
    deps.setReviewActive(false)
  }
}

/** True when a quick create hit a setup blocker; the dialog then replaces the transient overlay. */
function quickCreateBlocked(msg: AgentManagerWorktreeSetupMessage, quick: QuickCreate | undefined): boolean {
  if (!quick) return false
  const mine = msg.requestId === quick.requestId
  if (mine && msg.status === "error" && (msg.errorCode === "not_git_repo" || msg.errorCode === "no_commits")) {
    quick.blocked(quick.project)
    return true
  }
  // A terminal message for this request ends the marker. A ready message may come from the session
  // stage without the request ID, so its project is enough; an error never clears another request.
  if (mine && msg.status !== "creating") quick.done()
  else if (msg.status === "ready" && (msg.projectId === quick.project || msg.projectId === undefined)) quick.done()
  return false
}

export function applySessionAdded(msg: AgentManagerSessionAddedMessage, deps: {
  currentProjectId: Accessor<string | undefined>
  resume: (sessionId: string) => void
  saveTabMemory: () => void
  appendOrder: (worktreeId: string, sessionId: string) => void
  setSelection: (id: string) => void
  evictLocal: (id: string) => void
  focusLocal: (id: string) => void
  applyDraft: (worktreeId: string, sessionId: string) => void
  selectSession: (id: string) => void
  requestChatFocus: (force?: boolean) => void
  /** Whether the panel filed this session without taking the view; consumes the mark. */
  quiet: (id: string) => boolean
  placeLocal: (id: string) => void
}) {
  if (!isCurrent(msg, deps.currentProjectId())) return
  // The host filing the session opens it again, even when the user closed its tab before this message arrived.
  deps.resume(msg.sessionId)
  // A send that resolved after the user moved on files its session without pulling the user back.
  if (deps.quiet(msg.sessionId)) {
    if (msg.worktreeId === LOCAL) return deps.placeLocal(msg.sessionId)
    deps.appendOrder(msg.worktreeId, msg.sessionId)
    deps.evictLocal(msg.sessionId)
    return
  }
  deps.saveTabMemory()
  // The host files a session that runs outside every worktree under Local, where it reads from the root store.
  if (msg.worktreeId === LOCAL) {
    deps.focusLocal(msg.sessionId)
    return
  }
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
