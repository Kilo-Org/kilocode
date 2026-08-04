/** @jsxImportSource solid-js */

/**
 * Apply-to-local workflow for Agent Manager.
 *
 * Owns everything about applying a selected worktree's diff into the local
 * repo: the per-worktree apply status, the dialog's file selection state, the
 * derived memos that drive `ApplyDialog`, and the result/toast handling for
 * the backend's `applyWorktreeDiffResult` message. Extracted from
 * `AgentManagerApp.tsx` so the app component only wires the workflow in.
 */

import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import { groupApplyConflicts } from "./apply-conflicts"
import { ApplyDialog } from "./ApplyDialog"
import { composeDiffId } from "./diff-scope-state"
import type { tracker } from "./telemetry"
import type { useDialog } from "@kilocode/kilo-ui/context/dialog"
import type { useLanguage } from "../src/context/language"
import type { useVSCode } from "../src/context/vscode"
import type { AgentManagerApplyWorktreeDiffResultMessage, WorktreeFileDiff } from "../src/types/messages"

interface ApplyState {
  status: AgentManagerApplyWorktreeDiffResultMessage["status"]
  message: string
  conflicts: NonNullable<AgentManagerApplyWorktreeDiffResultMessage["conflicts"]>
}

interface ApplyToLocalOptions {
  vscode: ReturnType<typeof useVSCode>
  dialog: ReturnType<typeof useDialog>
  t: ReturnType<typeof useLanguage>["t"]
  /** Current sidebar selection (LOCAL, a worktree id, or null). */
  selection: Accessor<string | null>
  /** Sentinel id for the local repo selection. */
  local: string
  worktrees: Accessor<{ id: string }[]>
  diffDatas: Accessor<Record<string, WorktreeFileDiff[]>>
  diffLoading: Accessor<boolean>
  /** Telemetry: metrics.track(name, surface, data). */
  track: ReturnType<typeof tracker>["track"]
}

export function createApplyToLocal(opts: ApplyToLocalOptions) {
  const { vscode, dialog, t, selection, local, worktrees, diffDatas, diffLoading } = opts

  const [applyStates, setApplyStates] = createSignal<Record<string, ApplyState>>({})
  const [applyTarget, setApplyTarget] = createSignal<string | undefined>()
  const [applySelectedFiles, setApplySelectedFiles] = createSignal<string[]>([])
  const [applySelectionTouched, setApplySelectionTouched] = createSignal(false)

  const applyStateForSelection = createMemo(() => {
    const sel = selection()
    if (!sel || sel === local) return undefined
    return applyStates()[sel]
  })

  const applyBusyForSelection = createMemo(() => {
    const state = applyStateForSelection()
    if (!state) return false
    return state.status === "checking" || state.status === "applying"
  })

  // Apply diffs come from the branch-scoped diff data of the target worktree
  // (keyed by `worktreeId#branch`, matching the review surfaces).
  const applyDiffKey = createMemo(() => {
    const target = applyTarget()
    if (!target) return undefined
    return composeDiffId(target, "branch")
  })

  const applyDiffs = createMemo(() => {
    const key = applyDiffKey()
    if (!key) return [] as WorktreeFileDiff[]
    return diffDatas()[key] ?? ([] as WorktreeFileDiff[])
  })

  const applyStateForTarget = createMemo(() => {
    const target = applyTarget()
    if (!target) return undefined
    return applyStates()[target]
  })

  const applyBusyForTarget = createMemo(() => {
    const state = applyStateForTarget()
    if (!state) return false
    return state.status === "checking" || state.status === "applying"
  })

  const applySelectedSet = createMemo(() => new Set(applySelectedFiles()))

  const applySelectionStats = createMemo(() => {
    const set = applySelectedSet()
    const selected = applyDiffs().filter((diff) => set.has(diff.file))
    const additions = selected.reduce((sum, diff) => sum + diff.additions, 0)
    const deletions = selected.reduce((sum, diff) => sum + diff.deletions, 0)
    return {
      total: applyDiffs().length,
      selected: selected.length,
      additions,
      deletions,
    }
  })

  const applyHasSelection = createMemo(() => applySelectionStats().selected > 0)

  const applyConflictRows = createMemo(() => groupApplyConflicts(applyStateForTarget()?.conflicts ?? []))

  const applyToLocal = (worktreeId: string, selectedFiles: string[]) => {
    setApplyStates((prev) => ({
      ...prev,
      [worktreeId]: {
        status: "checking",
        message: t("agentManager.apply.checking"),
        conflicts: [],
      },
    }))
    vscode.postMessage({ type: "agentManager.applyWorktreeDiff", worktreeId, selectedFiles })
  }

  const resetApplyDialog = () => {
    setApplyTarget(undefined)
    setApplySelectedFiles([])
    setApplySelectionTouched(false)
  }

  const closeApplyDialog = () => {
    resetApplyDialog()
    dialog.close()
  }

  const applySelectAll = () => {
    setApplySelectionTouched(true)
    setApplySelectedFiles(applyDiffs().map((diff) => diff.file))
  }

  const applySelectNone = () => {
    setApplySelectionTouched(true)
    setApplySelectedFiles([])
  }

  const applyToggleFile = (file: string, checked: boolean) => {
    setApplySelectionTouched(true)
    setApplySelectedFiles((prev) => {
      if (checked) {
        if (prev.includes(file)) return prev
        const set = new Set(prev)
        set.add(file)
        return applyDiffs()
          .map((diff) => diff.file)
          .filter((path) => set.has(path))
      }
      if (!prev.includes(file)) return prev
      return prev.filter((path) => path !== file)
    })
  }

  const triggerApply = () => {
    const target = applyTarget()
    if (!target) return
    if (!applyHasSelection()) return
    if (applyBusyForTarget()) return
    opts.track("apply_to_local", "apply_dialog", { fileCount: applySelectedFiles().length })
    applyToLocal(target, applySelectedFiles())
  }

  const openApplyDialog = () => {
    const sel = selection()
    if (!sel || sel === local) return
    setApplyStates((prev) => {
      if (!prev[sel]) return prev
      const next = { ...prev }
      delete next[sel]
      return next
    })
    setApplyTarget(sel)
    setApplySelectionTouched(false)
    setApplySelectedFiles([])
    vscode.postMessage({ type: "agentManager.requestWorktreeDiff", sessionId: sel })

    setApplySelectedFiles(applyDiffs().map((diff) => diff.file))

    dialog.show(
      () => (
        <ApplyDialog
          diffs={applyDiffs()}
          loading={diffLoading()}
          selectedFiles={applySelectedSet()}
          selectedCount={applySelectionStats().selected}
          additions={applySelectionStats().additions}
          deletions={applySelectionStats().deletions}
          busy={applyBusyForTarget()}
          hasSelection={applyHasSelection()}
          status={applyStateForTarget()?.status}
          message={applyStateForTarget()?.message}
          conflictRows={applyConflictRows()}
          onSelectAll={applySelectAll}
          onSelectNone={applySelectNone}
          onToggleFile={applyToggleFile}
          onApply={triggerApply}
          onClose={closeApplyDialog}
        />
      ),
      resetApplyDialog,
    )
  }

  // Keep the dialog selection in step with the diff set: select everything on
  // first load, then drop files that disappear from the diff without clobbering
  // a selection the user has already made.
  createEffect(
    on(
      () => [applyTarget(), applyDiffs(), applySelectionTouched()] as const,
      ([target, diffs, touched]) => {
        if (!target) return
        const files = diffs.map((diff) => diff.file)
        if (files.length === 0) {
          if (!touched) setApplySelectedFiles([])
          return
        }

        if (!touched) {
          setApplySelectedFiles(files)
          return
        }

        const current = applySelectedFiles()
        const set = new Set(current)
        const next = files.filter((file) => set.has(file))
        const same = next.length === current.length && next.every((file, index) => file === current[index])
        if (!same) setApplySelectedFiles(next)
      },
    ),
  )

  // Drop apply state for worktrees that no longer exist, and close a dialog
  // whose target disappeared.
  createEffect(() => {
    const ids = new Set(worktrees().map((wt) => wt.id))
    setApplyStates((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id)))
      if (Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })

    const target = applyTarget()
    if (target && !ids.has(target)) closeApplyDialog()
  })

  // Backend `applyWorktreeDiffResult` message: record the new status and toast.
  const onApplyResult = (ev: AgentManagerApplyWorktreeDiffResultMessage) => {
    const files = new Set((ev.conflicts ?? []).map((entry) => entry.file).filter(Boolean)).size
    const count = ev.conflicts?.length ?? 0
    setApplyStates((prev) => ({
      ...prev,
      [ev.worktreeId]: {
        status: ev.status,
        message: ev.message,
        conflicts: ev.conflicts ?? [],
      },
    }))

    if (ev.status === "success") {
      showToast({ variant: "success", title: t("agentManager.apply.success"), description: ev.message })
      if (applyTarget() === ev.worktreeId) closeApplyDialog()
    }
    if (ev.status === "conflict") {
      const summary =
        count > 0 ? t("agentManager.apply.conflictToast", { count, files: Math.max(files, 1) }) : ev.message
      showToast({ variant: "error", title: t("agentManager.apply.conflict"), description: summary })
    }
    if (ev.status === "error") {
      showToast({ variant: "error", title: t("agentManager.apply.error"), description: ev.message })
    }
  }

  return {
    applyStateForSelection,
    applyBusyForSelection,
    openApplyDialog,
    onApplyResult,
  }
}
