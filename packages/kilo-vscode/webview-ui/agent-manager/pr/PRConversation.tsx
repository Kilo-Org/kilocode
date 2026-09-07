/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { sendReviewComments } from "../../diff-viewer/review-annotations"
import { CopyButton } from "./CopyButton"
import { PRCommentTime } from "./PRCommentTime"
import { SectionHeading } from "./SectionHeading"
import { commentState, patchCommentState } from "./pr-comment-state"
import { githubUrl, prConversationMarkdown, prConversationPayload, preview, SEND_LIMIT } from "./pr-comment-payload"
import type { PRConversationComment, ReviewerState } from "./pr-types"

const REVIEWER_ICON: Record<ReviewerState, string> = {
  approved: "circle-check",
  changes_requested: "refresh",
  commented: "edit",
  pending: "dash",
}

const REVIEWER_LABEL: Record<ReviewerState, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  commented: "Commented",
  pending: "Pending",
}

interface CardProps {
  comment: PRConversationComment
  open: boolean
  sent: boolean
  dismissed: boolean
  activeTerminalId?: string
  onToggleOpen: () => void
  onSend: () => void
  onDismiss: () => void
  onOpenUrl?: () => void
}

function PRConversationCard(props: CardProps) {
  const { t } = useLanguage()

  return (
    <div class="am-pr-comment" classList={{ "am-pr-comment-open": props.open }} data-thread-id={props.comment.id}>
      <button
        type="button"
        class="am-pr-comment-head am-pr-row"
        aria-expanded={props.open}
        onClick={props.onToggleOpen}
      >
        <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="am-pr-comment-chevron" />
        <Show when={props.comment.state}>
          {(state) => (
            <Icon
              name={REVIEWER_ICON[state()]}
              size="small"
              class="am-pr-comment-check"
              classList={{
                "am-pr-comment-tag-approved": state() === "approved",
                "am-pr-comment-tag-changes": state() === "changes_requested",
              }}
            />
          )}
        </Show>
        <span class="am-pr-comment-author">{props.comment.author}</span>
        <Show when={!props.open}>
          <span class="am-pr-comment-preview">{preview(props.comment.body)}</span>
        </Show>
        <div class="am-pr-comment-tags">
          <Show when={props.comment.state}>
            {(state) => (
              <span
                class="am-pr-comment-tag"
                classList={{
                  "am-pr-comment-tag-approved": state() === "approved",
                  "am-pr-comment-tag-changes": state() === "changes_requested",
                }}
              >
                {REVIEWER_LABEL[state()]}
              </span>
            )}
          </Show>
          <Show when={props.comment.isBot}>
            <span class="am-pr-comment-tag">bot</span>
          </Show>
          <Show when={props.dismissed}>
            <span class="am-pr-comment-tag">{t("agentManager.pr.conversation.dismiss")}</span>
          </Show>
          <Show when={props.sent}>
            <span class="am-pr-comment-tag am-pr-comment-tag-sent">{t("agentManager.pr.comment.sent")}</span>
          </Show>
          <PRCommentTime time={props.comment.createdAt} />
        </div>
      </button>

      <Show when={props.open}>
        <div class="am-pr-comment-body">
          <Markdown text={props.comment.body} />
        </div>
        <div class="am-pr-comment-actions am-pr-row">
          <Button variant="primary" size="small" disabled={props.sent} onClick={props.onSend}>
            {props.sent
              ? t("agentManager.pr.comment.sent")
              : t(props.activeTerminalId ? "agentManager.pr.comment.sendToTerminal" : "agentManager.pr.fixWithKilo")}
          </Button>
          <Button variant="secondary" size="small" class="am-pr-comment-btn" onClick={props.onDismiss}>
            {props.dismissed ? t("agentManager.pr.conversation.restore") : t("agentManager.pr.conversation.dismiss")}
          </Button>
          <span class="am-pr-comment-actions-gap" />
          <CopyButton text={prConversationMarkdown(props.comment)} label={t("agentManager.pr.comment.copy")} />
          <Show when={props.onOpenUrl}>
            <Tooltip value={t("agentManager.pr.comment.openOnGitHub")} placement="top">
              <IconButton
                icon="square-arrow-top-right"
                size="small"
                variant="ghost"
                label={t("agentManager.pr.comment.openOnGitHub")}
                onClick={() => props.onOpenUrl?.()}
              />
            </Tooltip>
          </Show>
        </div>
      </Show>
    </div>
  )
}

interface Props {
  comments: PRConversationComment[]
  projectId?: string
  worktreeId: string
  activeTerminalId?: string
  onOpenUrl?: (url: string) => void
}

export function PRConversation(props: Props) {
  const { t } = useLanguage()
  const state = () => commentState(props.worktreeId)
  const patch = (fn: (prev: ReturnType<typeof state>) => Partial<ReturnType<typeof state>>) =>
    patchCommentState(props.worktreeId, fn)

  const open = () => state().conversationOpen ?? true
  const setOpen = (v: boolean) => patch(() => ({ conversationOpen: v }))

  const sent = (id: string) => !!state().sent[id]
  const dismissed = (id: string) => !!state().dismissed[id]
  const expandedFor = (comment: PRConversationComment) =>
    state().expanded[comment.id] ?? (!comment.isBot && !sent(comment.id) && !dismissed(comment.id))

  const toggleOpen = (comment: PRConversationComment) => {
    const next = !expandedFor(comment)
    patch((prev) => ({ expanded: { ...prev.expanded, [comment.id]: next } }))
  }

  const toggleDismiss = (comment: PRConversationComment) => {
    const next = !dismissed(comment.id)
    patch((prev) => ({
      dismissed: { ...prev.dismissed, [comment.id]: next },
      expanded: { ...prev.expanded, [comment.id]: !next },
    }))
  }

  const actionable = createMemo(() =>
    props.comments.filter((c) => !c.isBot && !sent(c.id) && !dismissed(c.id)).map((c) => c.id),
  )

  function send(ids: string[]) {
    const map = new Map(props.comments.map((c) => [c.id, c]))
    const batch = ids
      .flatMap((id) => {
        const comment = map.get(id)
        return comment && !state().sent[id] ? [comment] : []
      })
      .slice(0, SEND_LIMIT)
    if (batch.length === 0) return
    sendReviewComments(batch.map(prConversationPayload), props.activeTerminalId)
    patch((prev) => {
      const nextSent = { ...prev.sent }
      for (const item of batch) nextSent[item.id] = true
      return { sent: nextSent }
    })
  }

  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading
          title={t("agentManager.pr.conversation.title")}
          open={open()}
          onToggle={() => setOpen(!open())}
          count={props.comments.length > 0 ? String(props.comments.length) : undefined}
        />
        <Show when={open()}>
          <Show when={actionable().length > 1}>
            <Button variant="primary" size="small" class="am-pr-comment-send-all" onClick={() => send(actionable())}>
              {t(
                props.activeTerminalId
                  ? "agentManager.pr.conversation.sendAllToTerminal"
                  : "agentManager.pr.conversation.sendAll",
                { count: Math.min(actionable().length, SEND_LIMIT) },
              )}
            </Button>
          </Show>
          <div class="am-pr-panel-comment-list am-pr-col">
            <For each={props.comments}>
              {(comment) => (
                <PRConversationCard
                  comment={comment}
                  open={expandedFor(comment)}
                  sent={sent(comment.id)}
                  dismissed={dismissed(comment.id)}
                  activeTerminalId={props.activeTerminalId}
                  onToggleOpen={() => toggleOpen(comment)}
                  onSend={() => send([comment.id])}
                  onDismiss={() => toggleDismiss(comment)}
                  onOpenUrl={
                    githubUrl(comment.url) && props.onOpenUrl
                      ? () => props.onOpenUrl?.(githubUrl(comment.url)!)
                      : undefined
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
