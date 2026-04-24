import { type Component, For, Show } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import type { AgentManagerApplyWorktreeDiffStatus, WorktreeFileDiff } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import { FileTree } from "./FileTree"
import { mapApplyConflictReason, type ApplyConflictRow } from "./apply-conflicts"

interface ApplyDialogProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  selectedFiles: Set<string>
  selectedCount: number
  additions: number
  deletions: number
  busy: boolean
  hasSelection: boolean
  status?: AgentManagerApplyWorktreeDiffStatus
  message?: string
  conflictRows: ApplyConflictRow[]
  onSelectAll: () => void
  onSelectNone: () => void
  onToggleFile: (file: string, checked: boolean) => void
  onApply: () => void
  onClose: () => void
}

export const ApplyDialog: Component<ApplyDialogProps> = (props) => {
  const { t } = useLanguage()

  const conflictReason = (reason: string) => {
    const mapped = mapApplyConflictReason(reason)
    if (mapped === "index") return t("agentManager.apply.reason.index")
    if (mapped === "patch") return t("agentManager.apply.reason.patch")
    if (mapped === "contents") return t("agentManager.apply.reason.contents")
    return reason || t("agentManager.apply.reason.unknown")
  }

  return (
    <Dialog title={t("agentManager.apply.dialogTitle")} size="large">
      <div
        class="am-apply-dialog"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault()
            e.stopPropagation()
            props.onApply()
            return
          }
          if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            props.onClose()
          }
        }}
      >
        <div class="am-apply-dialog-toolbar">
          <div class="am-apply-dialog-summary">
            {t("agentManager.apply.selectionSummary", {
              selected: props.selectedCount,
              total: props.diffs.length,
            })}
            <span class="am-stat-additions">+{props.additions}</span>
            <span class="am-stat-deletions">-{props.deletions}</span>
          </div>
          <div class="am-apply-dialog-actions">
            <Button
              size="small"
              variant="secondary"
              onClick={props.onSelectAll}
              disabled={props.busy || props.diffs.length === 0}
            >
              {t("agentManager.apply.selectAll")}
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={props.onSelectNone}
              disabled={props.busy || !props.hasSelection}
            >
              {t("agentManager.apply.selectNone")}
            </Button>
          </div>
        </div>

        <div class="am-apply-dialog-tree">
          <Show
            when={props.diffs.length > 0}
            fallback={
              <div class="am-diff-empty">
                {props.loading ? t("session.review.loadingChanges") : t("session.review.noChanges")}
              </div>
            }
          >
            <FileTree
              diffs={props.diffs}
              activeFile={null}
              onFileSelect={() => undefined}
              selectedFiles={props.selectedFiles}
              onFileToggle={props.onToggleFile}
              showSummary={false}
            />
          </Show>
        </div>

        <Show when={props.status === "conflict" && props.conflictRows.length > 0}>
          <div class="am-apply-conflicts">
            <div class="am-apply-conflicts-title">{t("agentManager.apply.conflictsTitle")}</div>
            <Show when={props.message}>
              <div class="am-apply-alert">{props.message}</div>
            </Show>
            <For each={props.conflictRows}>
              {(entry) => (
                <div class="am-apply-conflict">
                  <span class="am-apply-conflict-file">{entry.file ?? t("agentManager.apply.unknownFile")}</span>
                  <span class="am-apply-conflict-reason">{conflictReason(entry.reasons[0] ?? "")}</span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={props.status === "error" && props.message}>
          <div class="am-apply-alert">{props.message}</div>
        </Show>

        <div class="am-apply-dialog-footer">
          <Button variant="secondary" size="large" onClick={props.onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" size="large" disabled={!props.hasSelection || props.busy} onClick={props.onApply}>
            <Show when={props.busy} fallback={t("agentManager.apply.confirm")}>
              <>
                <Spinner class="am-apply-spinner" />
                {t("agentManager.apply.applying")}
              </>
            </Show>
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
