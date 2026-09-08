/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { PRCommentBody } from "./PRCommentBody"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { useVSCode } from "../../src/context/vscode"
import { CopyButton } from "./CopyButton"
import { PRCommentTime } from "./PRCommentTime"
import { SectionHeading } from "./SectionHeading"
import { actionableConversation, sendConversation } from "./pr-actions"
import { commentState, createReactionController, patchCommentState } from "./pr-comment-state"
import { githubUrl, prConversationMarkdown, preview, SEND_LIMIT } from "./pr-comment-payload"
import type { PRConversationComment, PRReaction, PRReactionContent, ReviewerState } from "./pr-types"
import { PRReactions } from "./PRReactions"
import { PRCommentForm } from "./PRCommentForm"

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
  projectId?: string
  worktreeId: string
  prNumber: number
  prUrl: string
  comment: PRConversationComment
  open: boolean
  sent: boolean
  dismissed: boolean
  activeTerminalId?: string
  onToggleOpen: () => void
  onSend: () => void
  onDismiss: () => void
  onOpenUrl?: () => void
  reactionError?: string
  reactions?: PRReaction[]
  reactionPending?: (content: PRReactionContent) => boolean
  onReaction?: (content: PRReactionContent, add: boolean) => void
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
        <PRCommentBody comment={props.comment} target={props.comment.kind === "issue" ? props : undefined} />
        <Show when={props.reactionError}>{(err) => <div class="am-pr-comment-error">{err()}</div>}</Show>
        <div class="am-pr-comment-actions am-pr-row">
          <Button variant="primary" size="small" disabled={props.sent} onClick={props.onSend}>
            {props.sent
              ? t("agentManager.pr.comment.sent")
              : t(props.activeTerminalId ? "agentManager.pr.comment.sendToTerminal" : "agentManager.pr.fixWithKilo")}
          </Button>
          <Button variant="secondary" size="small" class="am-pr-comment-btn" onClick={props.onDismiss}>
            {props.dismissed ? t("agentManager.pr.conversation.restore") : t("agentManager.pr.conversation.dismiss")}
          </Button>
          <Show when={props.onReaction}>
            <PRReactions
              reactions={props.reactions ?? props.comment.reactions}
              pending={props.reactionPending}
              onToggle={(content, add) => props.onReaction?.(content, add)}
            />
          </Show>
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
      <div class="am-pr-comment-footer">
        <Button
          data-action="toggle-thread"
          variant="ghost"
          size="small"
          aria-expanded={props.open}
          onClick={props.onToggleOpen}
        >
          <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" />
          {t(props.open ? "agentManager.pr.comment.collapseThread" : "agentManager.pr.comment.expandThread")}
        </Button>
      </div>
    </div>
  )
}

interface Props {
  prNumber: number
  prUrl: string
  comments: PRConversationComment[]
  projectId?: string
  worktreeId: string
  activeTerminalId?: string
  onOpenUrl?: (url: string) => void
}

export function PRConversation(props: Props) {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const reactions = createReactionController({
    worktree: () => props.worktreeId,
    project: () => props.projectId,
    post: vscode.postMessage,
    onMessage: vscode.onMessage,
    fail: (error) => t("agentManager.pr.comment.reactionFailed", { error: error || t("common.requestFailed") }),
  })
  const index = createMemo(() => new Map(props.comments.map((comment) => [comment.id, comment])))
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

  const actionable = createMemo(() => actionableConversation(props.comments, state()))

  function send(ids: string[]) {
    sendConversation(props.worktreeId, props.comments, ids, state(), props.activeTerminalId)
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
            <For each={[...index().keys()]}>
              {(id) => (
                <Show when={index().get(id)}>
                  {(comment) => (
                    <PRConversationCard
                      projectId={props.projectId}
                      worktreeId={props.worktreeId}
                      prNumber={props.prNumber}
                      prUrl={props.prUrl}
                      comment={comment()}
                      open={expandedFor(comment())}
                      sent={sent(id)}
                      dismissed={dismissed(id)}
                      activeTerminalId={props.activeTerminalId}
                      onToggleOpen={() => toggleOpen(comment())}
                      onSend={() => send([id])}
                      onDismiss={() => toggleDismiss(comment())}
                      reactionError={reactions.error(id)}
                      reactions={reactions.list(id, comment().reactions)}
                      reactionPending={(content) => reactions.pending(id, content)}
                      onReaction={(content, add) => reactions.toggle(id, content, add)}
                      onOpenUrl={
                        githubUrl(comment().url) && props.onOpenUrl
                          ? () => props.onOpenUrl?.(githubUrl(comment().url)!)
                          : undefined
                      }
                    />
                  )}
                </Show>
              )}
            </For>
          </div>
          <PRCommentForm
            action="create"
            projectId={props.projectId}
            worktreeId={props.worktreeId}
            prNumber={props.prNumber}
            prUrl={props.prUrl}
          />
        </Show>
      </div>
    </>
  )
}
