import type { KiloClient } from "@kilocode/sdk/v2/client"
import { PLATFORM } from "./constants"
import type { WorktreeStateManager } from "./WorktreeStateManager"

/** A host-resolved request to copy one worktree's root sessions into Cloud. */
export interface ContinueCloudRequest {
  readonly worktreeId: string
  readonly directory: string
  readonly sessionIds: readonly string[]
  readonly activeSessionId: string
}

/** Host capabilities Continue-in-Cloud needs. Kept small so the module stays vscode-free. */
export interface ContinueCloudHost {
  client: () => KiloClient
  /** Report a terminal failure the user cannot act on. */
  error: (message: string) => void
  /** Ask the user to choose one action; undefined when dismissed. */
  choose: (kind: "info" | "error", message: string, actions: readonly string[]) => Promise<string | undefined>
  openUrl: (url: string) => void
  copy: (text: string) => void
  capture: (event: string, props: Record<string, unknown>) => void
  log: (...args: unknown[]) => void
  /** Invoked once the operation key is chosen, so progress events can be keyed. */
  onOperation: (worktreeId: string, operationKey: string) => void
  /**
   * Run one SDK dispatch behind the keyed progress indicator. The scope closes
   * as soon as `run` settles, so a result prompt never keeps the operation — or
   * its duplicate-click guard — alive.
   */
  dispatch: (worktreeId: string, directory: string, run: () => Promise<void>) => Promise<void>
}

/** The maximum number of root sessions one continuation may copy. */
export const CONTINUATION_MAX = 10

export type ContinuationStage = "checking" | "syncing" | "creating"

/** The visible progress label for each real stage event. */
export const STAGE_LABEL: Record<ContinuationStage, string> = {
  checking: "Checking the worktree…",
  syncing: "Syncing sessions…",
  creating: "Creating the Cloud workspace…",
}

/** The action for each continuation error code (contract A). */
export const CONTINUATION_ACTIONS: Record<string, string> = {
  worktree_dirty: "Commit or stash local changes, then retry.",
  branch_detached: "Check out a branch, then retry.",
  branch_no_upstream: "Push the branch with an upstream, then retry.",
  branch_not_pushed: "Push the branch to the remote, then retry.",
  remote_unsupported: "Only GitHub and GitLab remotes are supported.",
  session_not_in_worktree: "Select sessions that belong to this worktree.",
  session_busy: "Wait for the selected sessions to become idle, then retry.",
  session_changed: "A session changed while preparing. Retry.",
  sync_unavailable: "Sign in to Kilo with session sync enabled, then retry.",
  sync_failed: "Session sync did not finish. Retry.",
  organization_mismatch: "The selected sessions belong to different accounts.",
  insufficient_balance: "Kilo Cloud needs balance for this worktree. Add balance, then retry.",
  continuation_incomplete: "Kilo Cloud created part of the workspace. Retry to finish.",
  creation_in_progress: "Kilo Cloud is still completing the workspace. Retry shortly.",
  operation_key_reuse_mismatch: "This request changed. Start over.",
  invalid_request: "Kilo Cloud rejected the request.",
  rejected: "Kilo Cloud rejected the request.",
  unauthorized: "Sign in to Kilo, then retry.",
  signed_out: "Sign in to Kilo, then retry.",
  auth_unavailable: "Kilo credentials are unavailable. Retry.",
  unavailable: "Kilo Cloud is temporarily unavailable. Retry.",
  invalid_response: "Kilo Cloud returned an invalid response. Retry with the same request.",
}

/**
 * Codes where a retry with the same operation key cannot help: a local
 * precondition that never reached Cloud, a definitive Cloud rejection, or an
 * unavailable sync. Every other outcome — including a missing code, a transport
 * ambiguity, a 5xx, an invalid response, insufficient balance, an incomplete
 * creation, and a creation in progress — keeps the key, so one partial
 * operation never produces a second workspace. After a terminal drop the next
 * click captures a new host selection under a new key.
 */
const TERMINAL = new Set([
  "worktree_dirty",
  "branch_detached",
  "branch_no_upstream",
  "branch_not_pushed",
  "remote_unsupported",
  "session_not_in_worktree",
  "session_busy",
  "session_changed",
  "sync_unavailable",
  "organization_mismatch",
  "operation_key_reuse_mismatch",
  "rejected",
  "invalid_request",
])

/**
 * Keep the operation key when a retry can still help. `ambiguous` marks a
 * transport failure with no response at all; an undefined code marks a reply
 * that carried no actionable code (for example an SDK error for a 502/503).
 */
export function retainKey(code: string | undefined, ambiguous: boolean): boolean {
  if (ambiguous) return true
  if (code === undefined) return true
  return !TERMINAL.has(code)
}

/**
 * The stage a global `session.host.continuation` event reports, but only when it
 * belongs to the operation in flight. A wrong key is ignored entirely, so a
 * concurrent or stale operation never moves this panel's progress.
 */
export function continuationStage(event: unknown, operationKey: string | undefined): ContinuationStage | undefined {
  if (!operationKey || event == null || typeof event !== "object") return undefined
  const record = event as { type?: unknown; properties?: unknown }
  if (record.type !== "session.host.continuation") return undefined
  if (record.properties == null || typeof record.properties !== "object") return undefined
  const props = record.properties as { operationKey?: unknown; stage?: unknown }
  if (props.operationKey !== operationKey) return undefined
  return props.stage === "checking" || props.stage === "syncing" || props.stage === "creating" ? props.stage : undefined
}

/** Modes Cloud replaced with a named fallback, in source order. */
export function fallbackModes(sessions: readonly { agent: { mode: string }; modeFallback: boolean }[]): string[] {
  return sessions.filter((session) => session.modeFallback).map((session) => session.agent.mode)
}

interface Attempt {
  operationKey: string
  request: ContinueCloudRequest
}

/**
 * One captured request per worktree. The operation key and its inputs are taken
 * once and reused on every retry, so a retry never recomputes the branch, model,
 * or variant. The entry is cleared when the attempt succeeds or becomes final.
 */
const attempts = new Map<string, Attempt>()

/** Clear retained attempts for test isolation. */
export function resetContinuationAttempts(): void {
  attempts.clear()
}

/** The retained operation key for a worktree, if a retry is still possible. */
export function currentOperation(worktreeId: string): string | undefined {
  return attempts.get(worktreeId)?.operationKey
}

function attempt(id: string, request: ContinueCloudRequest): Attempt {
  const existing = attempts.get(id)
  if (existing) return existing
  const created: Attempt = { operationKey: crypto.randomUUID(), request }
  attempts.set(id, created)
  return created
}

function readCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const record = error as { code?: unknown; data?: { code?: unknown }; _tag?: unknown }
  if (typeof record.code === "string") return record.code
  const nested = record.data?.code
  if (typeof nested === "string") return nested
  if (record._tag === "UnauthorizedError") return "unauthorized"
  if (record._tag === "ServiceUnavailableError") return "unavailable"
  if (record._tag === "UpstreamError") return "invalid_response"
  return undefined
}

/**
 * Continue one local worktree in Cloud. The CLI owns Git, session, and sync
 * validation and returns a browser URL; this function captures the request once,
 * reuses the same operation key on every retry, and offers Open and Copy Link on
 * success. It never opens the browser automatically.
 */
export async function continueInCloud(host: ContinueCloudHost, req: ContinueCloudRequest): Promise<null> {
  const existing = attempts.get(req.worktreeId)
  if (!existing) {
    if (req.sessionIds.length === 0) {
      host.error("Open at least one session in this worktree before continuing in Cloud.")
      return null
    }
    if (req.sessionIds.length > CONTINUATION_MAX) {
      host.error(
        `Continue in Cloud copies at most ${CONTINUATION_MAX} sessions. Close some sessions in this worktree, then retry.`,
      )
      return null
    }
    if (!req.sessionIds.includes(req.activeSessionId)) {
      host.error("The active session must be one of the sessions copied to Cloud.")
      return null
    }
  }

  let client: KiloClient
  try {
    client = host.client()
  } catch (error) {
    host.log("continueInCloud: client not available:", error)
    host.error("Not connected to the CLI backend.")
    return null
  }

  const captured = attempt(req.worktreeId, req)
  host.onOperation(req.worktreeId, captured.operationKey)

  let url: string | undefined
  let fallbacks: string[] = []
  let code: string | undefined
  let ambiguous = false

  // The dispatch scope ends as soon as the SDK call settles. The result prompt
  // below runs after the operation ended, so ignoring it cannot leave the
  // progress indicator or the duplicate-click guard active.
  await host.dispatch(req.worktreeId, captured.request.directory, async () => {
    try {
      const { data, error } = await client.sessionHost.continueWorkspace(
        {
          sessionHostContinueWorkspaceInput: {
            operationKey: captured.operationKey,
            directory: captured.request.directory,
            sessionIDs: [...captured.request.sessionIds],
            activeSessionID: captured.request.activeSessionId,
          },
        },
        { throwOnError: false },
      )
      if (data) {
        url = data.url
        fallbacks = fallbackModes(data.sessions)
        return
      }
      code = readCode(error)
    } catch (thrown) {
      // No response at all: the transport is ambiguous, so keep the key.
      ambiguous = true
      host.log("continueInCloud: transport error:", thrown)
    }
  })

  if (url !== undefined) return succeeded(host, req.worktreeId, url, fallbacks)
  return failed(host, req, code, ambiguous)
}

async function succeeded(host: ContinueCloudHost, worktreeId: string, url: string, fallbacks: string[]): Promise<null> {
  attempts.delete(worktreeId)
  host.capture("Agent Manager Continue in Cloud", {
    source: PLATFORM,
    worktreeId,
    fallbacks: fallbacks.length,
  })
  const note =
    fallbacks.length > 0 ? ` ${fallbacks.length} session(s) used a fallback mode: ${fallbacks.join(", ")}.` : ""
  const answer = await host.choose("info", `Continued in Cloud.${note}`, ["Open", "Copy Link"])
  if (answer === "Open") host.openUrl(url)
  if (answer === "Copy Link") host.copy(url)
  return null
}

async function failed(
  host: ContinueCloudHost,
  req: ContinueCloudRequest,
  code: string | undefined,
  ambiguous: boolean,
): Promise<null> {
  const keep = retainKey(code, ambiguous)
  if (!keep) attempts.delete(req.worktreeId)
  host.capture("Agent Manager Continue in Cloud Error", {
    source: PLATFORM,
    worktreeId: req.worktreeId,
    error: code ?? (ambiguous ? "transport" : "unknown"),
  })
  const action = (code && CONTINUATION_ACTIONS[code]) || "Continue in Cloud failed."
  const message = `Continue in Cloud failed (${code ?? "unknown"}): ${action}`
  if (!keep) {
    host.error(message)
    return null
  }
  const answer = await host.choose("error", `${message} Retry with the same request?`, ["Retry"])
  if (answer === "Retry") return continueInCloud(host, req)
  return null
}

/** Provider-owned capabilities used to build one continuation request. */
export interface ContinueCloudPanel {
  readonly state: WorktreeStateManager | undefined
  readonly activeSessionId: string | undefined
  readonly projectId: string | undefined
  readonly getClient: () => KiloClient
  readonly choose: (kind: "info" | "error", message: string, actions: readonly string[]) => Promise<string | undefined>
  readonly openUrl: (url: string) => void
  readonly copy: (text: string) => void
  readonly error: (message: string) => void
  readonly capture: (event: string, props: Record<string, unknown>) => void
  readonly log: (...args: unknown[]) => void
  readonly onOperation: (worktreeId: string, operationKey: string) => void
  readonly dispatch: (worktreeId: string, directory: string, run: () => Promise<void>) => Promise<void>
}

/**
 * Resolve one worktree's open root sessions and active session in the extension
 * host, then continue it in Cloud. The webview only sends the worktree identity;
 * this host-owned capture is why a retry keeps the same request.
 */
export async function startContinuation(panel: ContinueCloudPanel, worktreeId: string): Promise<null> {
  const state = panel.state
  if (!state) return null
  const worktree = state.getWorktree(worktreeId)
  if (!worktree) {
    panel.error(`Worktree ${worktreeId} was not found`)
    return null
  }
  const sessionIds = state
    .getSessions(worktreeId)
    .filter((session) => !state.isSessionClosed(session.id))
    .map((session) => session.id)
  const activeSessionId =
    panel.activeSessionId && sessionIds.includes(panel.activeSessionId) ? panel.activeSessionId : (sessionIds[0] ?? "")
  return continueInCloud(
    {
      client: panel.getClient,
      error: panel.error,
      choose: panel.choose,
      openUrl: panel.openUrl,
      copy: panel.copy,
      capture: panel.capture,
      log: panel.log,
      onOperation: panel.onOperation,
      dispatch: panel.dispatch,
    },
    { worktreeId, directory: worktree.path, sessionIds, activeSessionId },
  )
}

/**
 * The stage to show for the operation in flight, or undefined when the event is
 * not a real stage for this operation. A wrong operation key or another
 * worktree's directory is ignored entirely, so a concurrent or stale operation
 * never moves this operation's progress.
 */
export interface ActiveContinuation {
  readonly worktreeId: string
  readonly directory: string
  readonly operationKey: string | undefined
}

export interface ContinuationProgress {
  readonly worktreeId: string
  readonly stage: ContinuationStage
}

export function continuationProgress(active: ActiveContinuation, event: unknown): ContinuationProgress | undefined {
  if (!active.operationKey) return undefined
  if (event == null || typeof event !== "object") return undefined
  const properties = (event as { properties?: unknown }).properties
  if (properties == null || typeof properties !== "object") return undefined
  if ((properties as { directory?: unknown }).directory !== active.directory) return undefined
  const stage = continuationStage(event, active.operationKey)
  if (!stage) return undefined
  return { worktreeId: active.worktreeId, stage }
}

/** The host side of one continuation: keyed progress and its duplicate-click guard. */
export interface ContinuationUi {
  error: (message: string) => void
  withProgress: <T>(
    title: string,
    task: (cancelled: () => boolean, report: (message: string) => void) => Promise<T>,
    opts?: { cancellable?: boolean },
  ) => Promise<T>
}

export interface ContinuationController {
  /** True while an SDK dispatch is actually running. */
  active: () => boolean
  /** Forward a real progress event to the active operation, ignoring other keys. */
  onEvent: (event: unknown) => void
  /** Run one dispatch behind a keyed, non-cancellable progress scope. */
  dispatch: (worktreeId: string, directory: string, run: () => Promise<void>) => Promise<void>
  /** Remember the key for the next dispatch, chosen before its scope opens. */
  setKey: (operationKey: string) => void
}

/**
 * Own the operation lifecycle so the progress indicator and the duplicate-click
 * guard end the moment the SDK settles. A result prompt runs after this scope,
 * so ignoring it cannot leave either alive.
 */
export function createContinuationController(ui: ContinuationUi): ContinuationController {
  let active:
    | { worktreeId: string; directory: string; operationKey?: string; report: (message: string) => void }
    | undefined
  let pendingKey: string | undefined

  return {
    active: () => active !== undefined,
    setKey: (operationKey) => {
      pendingKey = operationKey
    },
    onEvent: (event) => {
      if (!active) return
      const progress = continuationProgress(
        { worktreeId: active.worktreeId, directory: active.directory, operationKey: active.operationKey },
        event,
      )
      if (progress) active.report(STAGE_LABEL[progress.stage])
    },
    dispatch: async (worktreeId, directory, run) => {
      let end: () => void = () => {}
      const settled = new Promise<void>((resolve) => {
        end = resolve
      })
      const progress = ui.withProgress(
        "Continue in Cloud",
        (_cancelled, report) => {
          active = { worktreeId, directory, operationKey: pendingKey, report }
          return settled
        },
        { cancellable: false },
      )
      try {
        await run()
      } finally {
        active = undefined
        end()
        await progress.catch(() => undefined)
      }
    },
  }
}
