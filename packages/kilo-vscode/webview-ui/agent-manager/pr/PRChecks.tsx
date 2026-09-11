/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { PRStatus } from "../../src/types/messages"
import type { PRCheck, CheckStatus } from "./pr-types"
import type { CheckBucket } from "./pr-check-groups"
import { counts, expands, groups } from "./pr-check-groups"
import { SectionHeading } from "./SectionHeading"
import { useConfig } from "../../src/context/config"
import { useVSCode } from "../../src/context/vscode"
import { useLanguage } from "../../src/context/language"
import { sendReviewComments } from "../../diff-viewer/review-annotations"
import { checkFeedback } from "./pr-check-feedback"
import { commentState, patchCommentState } from "./pr-comment-state"

const CHECK: Record<CheckStatus, string> = {
  success: "success",
  failure: "failure",
  cancelled: "cancelled",
  skipped: "skipped",
  pending: "pending",
}

const CHECK_ICON: Record<Exclude<CheckStatus, "pending">, string> = {
  success: "circle-check",
  failure: "circle-x-outline",
  cancelled: "stop",
  skipped: "circle-ban-sign",
}

function CheckIcon(props: { status: CheckStatus }) {
  if (props.status === "pending") return <Spinner class="am-pr-check-icon" />
  return <Icon name={CHECK_ICON[props.status]} size="small" class="am-pr-check-icon" aria-hidden="true" />
}

const GROUP_KEYS: Record<CheckBucket, { one: string; other: string }> = {
  failure: {
    one: "agentManager.pr.checks.group.failure.one",
    other: "agentManager.pr.checks.group.failure.other",
  },
  pending: {
    one: "agentManager.pr.checks.group.pending.one",
    other: "agentManager.pr.checks.group.pending.other",
  },
  cancelled: {
    one: "agentManager.pr.checks.group.cancelled.one",
    other: "agentManager.pr.checks.group.cancelled.other",
  },
  skipped: {
    one: "agentManager.pr.checks.group.skipped.one",
    other: "agentManager.pr.checks.group.skipped.other",
  },
  success: {
    one: "agentManager.pr.checks.group.success.one",
    other: "agentManager.pr.checks.group.success.other",
  },
}

const TALLY_KEYS: Record<CheckBucket, { one: string; other: string }> = {
  failure: {
    one: "agentManager.pr.checks.tally.failure.one",
    other: "agentManager.pr.checks.tally.failure.other",
  },
  pending: {
    one: "agentManager.pr.checks.tally.pending.one",
    other: "agentManager.pr.checks.tally.pending.other",
  },
  cancelled: {
    one: "agentManager.pr.checks.tally.cancelled.one",
    other: "agentManager.pr.checks.tally.cancelled.other",
  },
  skipped: {
    one: "agentManager.pr.checks.tally.skipped.one",
    other: "agentManager.pr.checks.tally.skipped.other",
  },
  success: {
    one: "agentManager.pr.checks.tally.success.one",
    other: "agentManager.pr.checks.tally.success.other",
  },
}

export function PRChecks(props: { pr: PRStatus; worktreeId?: string; activeTerminalId?: string }) {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const { settings } = useConfig()
  const [localOpen, setLocalOpen] = createSignal(true)
  const [localGroups, setLocalGroups] = createSignal<Partial<Record<CheckBucket, boolean>>>({})
  const state = () => (props.worktreeId ? commentState(props.worktreeId) : undefined)
  const open = () => state()?.checksOpen ?? localOpen()
  const grouped = createMemo(() => groups(props.pr.checks.checks))
  function groupLabel(bucket: CheckBucket, count: number) {
    return t(GROUP_KEYS[bucket][count === 1 ? "one" : "other"], { count })
  }
  function tallyLabel(bucket: CheckBucket, count: number) {
    return t(TALLY_KEYS[bucket][count === 1 ? "one" : "other"], { count })
  }
  const count = createMemo(() => {
    const all = counts(props.pr.checks.checks)
    const signal = all.filter((item) => item.bucket !== "success")
    return (signal.length > 0 ? signal : all)
      .map((item) => tallyLabel(item.bucket, item.count))
      .join(` ${t("agentManager.pr.checks.separator")} `)
  })
  const feedback = createMemo(() =>
    checkFeedback(
      props.pr,
      t("agentManager.pr.checks.feedback"),
      !props.activeTerminalId && settings()["agentManager.pushFixes"] !== false,
    ),
  )
  const groupOpen = (bucket: CheckBucket) => state()?.checkGroups[bucket] ?? localGroups()[bucket] ?? expands(bucket)
  const statusLabel = (status: CheckStatus) => t(`agentManager.pr.checks.status.${CHECK[status]}`)
  const send = () => {
    const item = feedback()
    if (!item) return
    sendReviewComments([item], props.activeTerminalId)
  }
  const toggleOpen = () => {
    const next = !open()
    if (props.worktreeId) patchCommentState(props.worktreeId, () => ({ checksOpen: next }))
    else setLocalOpen(next)
  }
  const toggleGroup = (bucket: CheckBucket) => {
    const next = !groupOpen(bucket)
    if (props.worktreeId) {
      patchCommentState(props.worktreeId, (prev) => ({ checkGroups: { ...prev.checkGroups, [bucket]: next } }))
      return
    }
    setLocalGroups((prev) => ({ ...prev, [bucket]: next }))
  }
  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading
          title={t("agentManager.pr.checks.title")}
          open={open()}
          onToggle={toggleOpen}
          count={count()}
          countClass={`am-pr-checks-count-${props.pr.checks.status}`}
        />
        <Show when={open()}>
          <Show when={feedback()}>
            <Button variant="primary" size="small" class="am-pr-checks-fix" onClick={send}>
              {t(props.activeTerminalId ? "agentManager.pr.checks.terminal" : "agentManager.pr.checks.fix")}
            </Button>
          </Show>
          <div
            class="am-pr-panel-checks am-pr-col"
            data-scrollable={props.pr.checks.checks.length > 12 ? "true" : undefined}
          >
            <For each={grouped()}>
              {(group) => (
                <div class="am-pr-check-group" data-bucket={group.bucket}>
                  <button
                    type="button"
                    class="am-pr-check-group-heading am-pr-panel-section-toggle am-pr-row"
                    aria-expanded={groupOpen(group.bucket)}
                    onClick={() => toggleGroup(group.bucket)}
                  >
                    <span>{groupLabel(group.bucket, group.checks.length)}</span>
                    <Icon
                      name={groupOpen(group.bucket) ? "chevron-down" : "chevron-right"}
                      size="small"
                      class="am-pr-section-chevron"
                    />
                  </button>
                  <Show when={groupOpen(group.bucket)}>
                    <div class="am-pr-check-group-items am-pr-col">
                      <For each={group.checks}>
                        {(check: PRCheck) => (
                          <div
                            class="am-pr-panel-check-item am-pr-row"
                            data-status={check.status}
                            aria-label={statusLabel(check.status)}
                          >
                            <CheckIcon status={check.status} />
                            <span class="am-pr-check-name">{check.name}</span>
                            <Show when={check.duration}>
                              <span class="am-pr-check-duration">{check.duration}</span>
                            </Show>
                            <Show when={check.url}>
                              <Tooltip value={t("agentManager.pr.checks.openInBrowser")} placement="bottom">
                                <button
                                  class="am-pr-check-link"
                                  aria-label={t("agentManager.pr.checks.openInBrowser")}
                                  onClick={() => vscode.postMessage({ type: "openExternal", url: check.url! })}
                                >
                                  <Icon name="link" size="small" />
                                </button>
                              </Tooltip>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
