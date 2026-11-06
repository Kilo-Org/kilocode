/**
 * Worktree readiness controller: asks the extension whether the selected project
 * can hold worktrees, runs the fixes a readiness card offers, and reports the
 * readiness telemetry. It knows nothing about the surface that shows the card.
 *
 * A check that fails, errors or misses its deadline settles as `unknown`, which
 * never blocks creation.
 */

import { createComputed, createSignal, on, onCleanup, type Accessor } from "solid-js"
import type { Readiness, ReadinessFix, ReadinessInstall, ReadinessMessage, WorktreeEntry } from "../src/types/messages"
import {
  codeForTool,
  errorText,
  installFix,
  isDownload,
  isInstall,
  labelForFix,
  toolFor,
  toolForCode,
  toolForInstall,
  type InstallFix,
} from "../../src/shared/worktree-readiness"
import { createContextRequests } from "../src/hooks/context-requests"
import { useVSCode } from "../src/context/vscode"
import { useLanguage } from "../src/context/language"
import { TelemetryEventName } from "../../src/services/telemetry/types"

import { FIX_DEADLINE_MS, INSTALL_DEADLINE_MS, READINESS_DEADLINE_MS } from "../../src/shared/worktree-readiness"

type Blocked = Extract<Readiness, { status: "blocked" }>

export type ReadinessState =
  | { status: "checking"; project?: string }
  | { status: "blocked"; project: string; result: Blocked; error?: string }
  | { status: "fixing"; project: string; result: Blocked; fix: ReadinessFix }
  | {
      status: "installing"
      project: string
      result: Blocked
      fix: InstallFix
      mode: "pending" | "apple"
    }
  | { status: "stale"; project: string; result: Blocked; fix: InstallFix }
  | { status: "ready"; project: string; note?: "uncommitted"; fixed?: ReadinessFix }
  | { status: "unknown"; project: string; detail: string }

function settle(project: string, result: Readiness, fixed?: ReadinessFix, error?: string): ReadinessState {
  if (result.status === "blocked") return { status: "blocked", project, result, ...(error ? { error } : {}) }
  if (result.status === "unknown") return { status: "unknown", project, detail: result.detail }
  return { status: "ready", project, ...(result.note ? { note: result.note } : {}), ...(fixed ? { fixed } : {}) }
}

function code(state: ReadinessState) {
  if ("result" in state) return state.result.code
  if (state.status === "unknown") return "unknown"
  return undefined
}

/** Telemetry stage for a settled transition, or nothing when it is a repeat of the same state. */
function stage(prev: ReadinessState, next: ReadinessState) {
  const before = code(prev)
  const after = code(next)
  if (after && (after !== before || prev.project !== next.project)) return { stage: "identified", code: after }
  if (next.status === "ready" && before && before !== "unknown") return { stage: "resolved", code: before }
  return undefined
}

/** The install a Git or Git LFS card represents; such a card re-checks fresh and on window return. */
function installFixFor(state: ReadinessState): InstallFix | undefined {
  if (state.status === "installing" || state.status === "stale") return state.fix
  if (state.status !== "blocked") return undefined
  const tool = toolForCode(state.result.code)
  return tool ? installFix(tool) : undefined
}

const CODE_TIPS: Partial<Record<Blocked["code"], string>> = {
  git_not_found: "agentManager.readiness.blockedGit",
  lfs_missing: "agentManager.readiness.blockedLfs",
  lfs_not_setup: "agentManager.readiness.blockedLfsSetup",
}

/** Why Create is disabled, and what unblocks it. */
export function tooltip(state: ReadinessState): { key: string; params?: { tool: string } } {
  if (state.status === "stale") return { key: "agentManager.readiness.install.reload" }
  if (state.status === "installing") {
    if (state.mode === "apple") return { key: "agentManager.readiness.install.apple.title" }
    return { key: "agentManager.readiness.install.terminal.title", params: { tool: labelForFix(state.fix) } }
  }
  if ("result" in state) {
    const key = CODE_TIPS[state.result.code]
    if (key) return { key }
  }
  return { key: "agentManager.readiness.blocked" }
}

export function createReadiness(opts: {
  project: Accessor<string | undefined>
  entry: WorktreeEntry
  /** A window-return re-check recovered a Git/LFS card; focus Create without clicking it. */
  onRecovered?: () => void
}) {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const scope = `readiness-${crypto.randomUUID()}`
  const checks = createContextRequests<ReadinessMessage>(
    `${scope}-check`,
    READINESS_DEADLINE_MS,
    "Readiness check timed out",
  )
  const fixes = createContextRequests<ReadinessMessage>(`${scope}-fix`, FIX_DEADLINE_MS, "Readiness fix timed out")
  const installs = createContextRequests<ReadinessMessage>(
    `${scope}-install`,
    INSTALL_DEADLINE_MS,
    "Readiness install timed out",
  )
  const [state, setState] = createSignal<ReadinessState>({ status: "checking", project: opts.project() })
  const flight = new Map<string, Promise<ReadinessState | undefined>>()
  let disposed = false
  let revision = 0
  let watching: Promise<void> | null = null

  createComputed(
    on(
      opts.project,
      () => {
        revision++
        flight.clear()
        checks.dispose("Readiness project changed", true)
        fixes.dispose("Readiness project changed", true)
        installs.dispose("Readiness project changed", true)
        // A switch fix already applied the selected project's result; keep it while it is re-checked.
        if (state().project !== opts.project()) setState({ status: "checking", project: opts.project() })
      },
      { defer: true },
    ),
  )

  const track = (props: { stage: string; code: string; fix?: ReadinessFix }) =>
    vscode.postMessage({
      type: "telemetry",
      event: TelemetryEventName.AGENT_MANAGER_WORKTREE_READINESS,
      properties: { ...props, entry: opts.entry },
    })

  const commitState = (next: ReadinessState, fix?: ReadinessFix) => {
    const event = stage(state(), next)
    setState(next)
    if (event) track({ ...event, ...(fix && event.stage === "resolved" ? { fix } : {}) })
  }

  const unsub = vscode.onMessage((msg) => {
    if (msg.type === "agentManager.readinessFocus") {
      if (!installFixFor(state()) || watching) return
      watching = check(true, true)
        .then((next) => {
          if (next?.status === "ready") opts.onRecovered?.()
        })
        .finally(() => {
          watching = null
        })
      return
    }
    if (msg.type !== "agentManager.readiness") return
    if (msg.projectId !== opts.project()) return
    checks.settle(msg.requestID, (req) => req.resolve(msg))
    fixes.settle(msg.requestID, (req) => req.resolve(msg))
    installs.settle(msg.requestID, (req) => req.resolve(msg))
  })

  onCleanup(() => {
    disposed = true
    unsub()
    const current = state()
    if ("result" in current && current.project === opts.project())
      track({ stage: "abandoned", code: current.result.code })
    checks.dispose("Readiness check cancelled")
    fixes.dispose("Readiness fix cancelled")
    installs.dispose("Readiness install cancelled")
  })

  /**
   * Ask for the current project's readiness. `fresh` bypasses the extension's
   * tool caches and refreshes its login-shell PATH. `keep` keeps showing a
   * Git/LFS card unless the fresh check is ready.
   */
  const check = (fresh = false, keep = false, verify = false): Promise<ReadinessState | undefined> => {
    const project = opts.project()
    if (!project) {
      setState({ status: "checking" })
      return Promise.resolve(undefined)
    }
    const running = flight.get(project)
    if (!fresh && !verify && running) return running
    // Keep showing this project's last result while it is checked again.
    if (state().project !== project) setState({ status: "checking", project })
    const version = revision
    const next = checks
      .request((requestID) =>
        vscode.postMessage({ type: "agentManager.checkReadiness", projectId: project, requestID, fresh, verify }),
      )
      .then(
        (msg) => settle(project, msg.result, installFixFor(state())),
        (err: unknown) => settle(project, { status: "unknown", detail: errorText(err) }),
      )
      .then((next) => {
        if (disposed || opts.project() !== project) return undefined
        if (revision !== version) return state()
        // A fix that started meanwhile owns the state.
        if (state().status === "fixing") return state()
        // A terminal install stays "Installing…" until the tool is ready; a check
        // must not drop the pending task and expose a second install button.
        const current = state()
        if (current.status === "installing" && current.mode === "pending" && next.status !== "ready") return current
        // A window-return check keeps a tool card only for an inconclusive result or
        // the same blocker. A different blocker (e.g. no_commits) must win.
        const same = next.status === "blocked" && "result" in current && next.result.code === current.result.code
        if (keep && next.status !== "ready" && (next.status === "unknown" || same)) return current
        commitState(next, installFixFor(state()))
        return next
      })
      .finally(() => {
        if (flight.get(project) === next) flight.delete(project)
      })
    flight.set(project, next)
    return next
  }

  /** Run a fix for the current blocker. Resolves the project a switch fix selected. */
  const runFix = async (
    kind: ReadinessFix,
    extra: { target?: string; identity?: { name: string; email: string } } = {},
  ): Promise<string | undefined> => {
    const current = state()
    const project = opts.project()
    // Downloads only open a page, so they are also valid from the Apple and stale cards.
    if (isDownload(kind)) {
      if (!project || !installFixFor(current) || current.project !== project) return undefined
      await fixes
        .request((requestID) =>
          vscode.postMessage({ type: "agentManager.fixReadiness", projectId: project, requestID, fix: kind, ...extra }),
        )
        .catch(() => undefined)
      return undefined
    }
    if (current.status !== "blocked" || current.project !== project) return undefined
    revision++
    const installKind = isInstall(kind) ? kind : undefined
    if (installKind)
      setState({ status: "installing", project, result: current.result, fix: installKind, mode: "pending" })
    else setState({ status: "fixing", project, result: current.result, fix: kind })
    track({ stage: "fix_started", code: current.result.code, fix: kind })
    const pool = installKind ? installs : fixes
    // A card for the folder the user just picked sets up that folder, not the selected project.
    const picked = current.result.picked && kind === "initGit" ? { target: "picked" } : {}
    const reply = await pool
      .request((requestID) =>
        vscode.postMessage({
          type: "agentManager.fixReadiness",
          projectId: project,
          requestID,
          fix: kind,
          ...picked,
          ...extra,
        }),
      )
      .catch((err: unknown) => ({
        selected: undefined,
        result: current.result,
        error: errorText(err),
        install: undefined,
      }))
    if (disposed || opts.project() !== project) return undefined
    // The fix outcome owns the state now; older check replies must not re-block Create.
    revision++
    if (installKind) {
      applyInstall(project, installKind, reply.result, reply.install, reply.error)
      return undefined
    }
    commitState(settle(reply.selected ?? project, reply.result, kind, reply.error), kind)
    return reply.selected
  }

  const applyInstall = (
    project: string,
    kind: InstallFix,
    result: Readiness,
    outcome: ReadinessInstall | undefined,
    error: string | undefined,
  ) => {
    if (result.status === "ready") return commitState(settle(project, result, kind), kind)
    if (result.status === "unknown") return commitState(settle(project, result))
    const expected = codeForTool(toolForInstall(kind))
    if (outcome?.mode === "apple" && !outcome.error && result.code === expected) {
      return commitState({ status: "installing", project, result, fix: kind, mode: "apple" })
    }
    if (outcome?.ok && result.code === expected) {
      return commitState({ status: "stale", project, result, fix: kind })
    }
    commitState(settle(project, result, kind, error ?? failure(outcome)))
  }

  /** Translate a terminal install's exit state for Show details. */
  const failure = (outcome: ReadinessInstall | undefined) => {
    if (!outcome) return undefined
    if (outcome.error) return outcome.error
    if (outcome.stopped) return t("agentManager.readiness.install.stopped")
    if (outcome.code !== undefined) return t("agentManager.readiness.install.failed", { code: outcome.code })
    return undefined
  }

  const blocked = () => {
    const current = state()
    return "result" in current && current.project === opts.project()
  }

  /** Check again from the card: a Git or Git LFS card refreshes the tool caches and PATH. */
  const recheck = () => {
    const current = state()
    void check(installFixFor(current) !== undefined, current.status === "stale")
  }

  return { state, blocked, check, recheck, fix: runFix, revision: () => revision }
}
