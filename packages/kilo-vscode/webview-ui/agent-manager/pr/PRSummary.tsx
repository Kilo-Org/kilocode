/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { PRStatus } from "../../src/types/messages"
import { useConfig } from "../../src/context/config"
import { useLanguage } from "../../src/context/language"
import { sendReviewComments } from "../../diff-viewer/review-annotations"
import { checkFeedback } from "./pr-check-feedback"
import { SEND_LIMIT } from "./pr-comment-payload"
import { commentState } from "./pr-comment-state"
import { type JumpTarget, actionableConversation, sendConversation, sendThreads, unsentThreads } from "./pr-actions"

interface PRSummaryProps {
  pr: PRStatus
  worktreeId: string
  activeTerminalId?: string
  onJump?: (target: JumpTarget) => void
}

interface Row {
  icon?: string
  label: string
  status: string
  target?: JumpTarget
  /** Secondary marks lower-confidence feedback, like general discussion. */
  action?: { label: string; run: () => void; variant?: "primary" | "secondary" }
}

const JUMP_KEY: Record<JumpTarget, string> = {
  checks: "agentManager.pr.summary.jump.checks",
  comments: "agentManager.pr.summary.jump.comments",
  conversation: "agentManager.pr.summary.jump.conversation",
}

export function PRSummary(props: PRSummaryProps) {
  const { t } = useLanguage()
  const { settings } = useConfig()
  const state = () => commentState(props.worktreeId)
  const statusIcon = (status: string) =>
    status === "success" ? "circle-check" : status === "failure" ? "circle-x-outline" : undefined

  const checks = (): Row | undefined => {
    const pr = props.pr
    if (pr.checks.total === 0) return
    const terminal = props.activeTerminalId
    const status = pr.checks.status
    const feedback = checkFeedback(
      pr,
      t("agentManager.pr.checks.feedback"),
      !terminal && settings()["agentManager.pushFixes"] !== false,
    )
    return {
      icon: statusIcon(status),
      label:
        status === "success"
          ? t("agentManager.pr.summary.checksPassing")
          : t("agentManager.pr.summary.checksPassed", { passed: pr.checks.passed, total: pr.checks.total }),
      status,
      target: "checks",
      action: feedback
        ? {
            label: t(terminal ? "agentManager.pr.checks.terminal" : "agentManager.pr.checks.fix"),
            run: () => sendReviewComments([feedback], terminal),
          }
        : undefined,
    }
  }

  const review = (): Row | undefined => {
    const value = props.pr.review
    if (!value) return
    const status = value === "approved" ? "success" : value === "changes_requested" ? "failure" : "pending"
    const key =
      status === "success"
        ? "agentManager.pr.summary.approved"
        : status === "failure"
          ? "agentManager.pr.summary.changesRequested"
          : "agentManager.pr.summary.reviewPending"
    return { icon: statusIcon(status), label: t(key), status }
  }

  const threads = (): Row | undefined => {
    const value = props.pr.comments
    if (!value || value.total === 0) return
    const terminal = props.activeTerminalId
    const unsent = unsentThreads(value.comments, state())
    return {
      icon: "comment",
      label:
        value.unresolved > 0
          ? t(
              value.unresolved === 1
                ? "agentManager.pr.summary.unresolved.one"
                : "agentManager.pr.summary.unresolved.other",
              { count: value.unresolved },
            )
          : t(value.total === 1 ? "agentManager.pr.summary.comments.one" : "agentManager.pr.summary.comments.other", {
              count: value.total,
            }),
      status: value.unresolved > 0 ? "warning" : "success",
      target: "comments",
      action:
        unsent.length > 0
          ? {
              label: t(terminal ? "agentManager.pr.comment.sendAllToTerminal" : "agentManager.pr.fixWithKiloCount", {
                count: Math.min(unsent.length, SEND_LIMIT),
              }),
              run: () => sendThreads(props.worktreeId, value.comments, unsent, state(), terminal),
            }
          : undefined,
    }
  }

  const conversation = (): Row | undefined => {
    const value = props.pr.conversation ?? []
    if (value.length === 0) return
    const terminal = props.activeTerminalId
    const ids = actionableConversation(value, state())
    return {
      icon: "comment",
      label: t(
        value.length === 1 ? "agentManager.pr.summary.conversation.one" : "agentManager.pr.summary.conversation.other",
        { count: value.length },
      ),
      status: ids.length > 0 ? "warning" : "success",
      target: "conversation",
      action:
        ids.length > 0
          ? {
              label: t(
                terminal ? "agentManager.pr.conversation.sendAllToTerminal" : "agentManager.pr.conversation.sendAll",
                { count: Math.min(ids.length, SEND_LIMIT) },
              ),
              run: () => sendConversation(props.worktreeId, value, ids, state(), terminal),
              variant: "secondary",
            }
          : undefined,
    }
  }

  const rows = createMemo(() => [checks(), review(), threads(), conversation()].filter((row) => row !== undefined))

  return (
    <Show when={rows().length > 0}>
      <div class="am-pr-summary">
        <div class="am-pr-summary-header am-pr-row">
          <span class="am-pr-summary-title">{t("agentManager.pr.summary.title")}</span>
          <span class="am-pr-panel-section-count am-pr-panel-diff am-pr-row">
            <Show when={props.pr.files > 0}>
              <span class="am-stat-files">{props.pr.files}f</span>
            </Show>
            <Show when={props.pr.additions > 0}>
              <span class="am-stat-additions">+{props.pr.additions}</span>
            </Show>
            <Show when={props.pr.deletions > 0}>
              <span class="am-stat-deletions">−{props.pr.deletions}</span>
            </Show>
          </span>
        </div>
        <div class="am-pr-summary-rows am-pr-col">
          <For each={rows()}>
            {(row) => (
              <div class="am-pr-summary-row am-pr-row" data-status={row.status} data-target={row.target}>
                <Show when={row.icon} fallback={<Spinner class="am-pr-summary-icon" />}>
                  {(icon) => <Icon name={icon()} size="small" class="am-pr-summary-icon" />}
                </Show>
                <span class="am-pr-summary-label">{row.label}</span>
                <Show when={row.action || (row.target && props.onJump)}>
                  <span class="am-pr-summary-actions am-pr-row">
                    <Show when={row.action}>
                      {(action) => (
                        <Button
                          variant={action().variant ?? "primary"}
                          size="small"
                          class="am-pr-summary-fix"
                          onClick={action().run}
                        >
                          {action().label}
                        </Button>
                      )}
                    </Show>
                    <Show when={row.target && props.onJump ? row.target : undefined}>
                      {(target) => (
                        <Tooltip value={t(JUMP_KEY[target()])} placement="bottom">
                          <IconButton
                            icon="arrow-down-to-line"
                            size="small"
                            variant="ghost"
                            class="am-pr-summary-jump"
                            aria-label={t(JUMP_KEY[target()])}
                            onClick={() => props.onJump?.(target())}
                          />
                        </Tooltip>
                      )}
                    </Show>
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
