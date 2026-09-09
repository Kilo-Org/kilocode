/** @jsxImportSource solid-js */
import { For, Show, createMemo, type JSXElement } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { PRCommentBody } from "./PRCommentBody"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { PRCommentDiff } from "../../diff-viewer/PRCommentDiff"
import { CopyButton } from "./CopyButton"
import { PRAvatar } from "./PRAvatar"
import { prMarkdown, preview } from "./pr-comment-payload"
import { PRCommentTime } from "./PRCommentTime"
import type { PRComment, PRReaction, PRReactionContent } from "./pr-types"
import { PRReactions } from "./PRReactions"
import { PRCommentForm } from "./PRCommentForm"

interface Props {
  projectId?: string
  worktreeId?: string
  prNumber?: number
  prUrl?: string
  applySuggestions?: boolean
  comment: PRComment
  resolved: boolean
  pending: boolean
  sent: boolean
  open: boolean
  inline?: boolean
  preview?: PRComment["preview"]
  error?: string
  reactionError?: string
  /** Polled reactions with an unconfirmed pick applied; falls back to the comment. */
  reactions?: PRReaction[]
  reactionPending?: (content: PRReactionContent) => boolean
  onReaction?: (content: PRReactionContent, add: boolean) => void
  replyReactionError?: (id: string) => string | undefined
  replyReactions?: (id: string, reactions?: PRReaction[]) => PRReaction[]
  replyReactionPending?: (id: string, content: PRReactionContent) => boolean
  onReplyReaction?: (id: string, content: PRReactionContent, add: boolean) => void
  onToggleOpen: () => void
  onToggleResolved?: () => void
  onSend: () => void
  onOpenFile?: () => void
  onOpenDiff?: () => void
  onOpenUrl?: () => void
}

export function PRCommentCard(props: Props) {
  const { t } = useLanguage()
  const replies = createMemo(() => new Map(props.comment.replies?.map((reply, index) => [reply.id ?? index, reply])))
  const target = () => {
    if (!props.worktreeId || !props.prNumber || !props.prUrl) return
    return {
      projectId: props.projectId,
      worktreeId: props.worktreeId,
      prNumber: props.prNumber,
      prUrl: props.prUrl,
    }
  }
  const eligible = () =>
    props.applySuggestions !== false && !props.comment.outdated && props.comment.side !== "deletions"
  const published = () => (eligible() ? target() : undefined)
  const location = () => {
    const file = props.comment.file
    if (!file) return ""
    return props.comment.line ? `${file}:${props.comment.line}` : file
  }

  // Only the panel opts into preview hunks; the header stays outside the annotation.
  const Content = (slot: { children: JSXElement }) => (
    <Show
      when={props.preview}
      fallback={
        <>
          <Show when={!props.inline && location()}>{(value) => <div class="am-pr-diff-file">{value()}</div>}</Show>
          <Show when={!props.inline && props.comment.diffHunk && props.comment.file}>
            <PRCommentDiff
              file={props.comment.file!}
              line={props.comment.originalLine ?? props.comment.line}
              side={props.comment.side}
              hunk={props.comment.diffHunk!}
              after={props.comment.after}
            />
          </Show>
          {slot.children}
        </>
      }
    >
      {(preview) => (
        <PRCommentDiff
          file={props.comment.file ?? ""}
          line={preview().line}
          side={preview().side}
          hunk={preview().patch}
          bottom={preview().bottom}
          inline
        >
          {slot.children}
        </PRCommentDiff>
      )}
    </Show>
  )

  return (
    <div
      class="am-pr-comment"
      classList={{ "am-pr-comment-open": props.open, "am-pr-comment-inline": props.inline }}
      data-thread-id={props.comment.threadId}
      data-source="pr"
    >
      <button
        type="button"
        class="am-pr-comment-head am-pr-row"
        aria-expanded={props.open}
        onClick={props.onToggleOpen}
      >
        <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="am-pr-comment-chevron" />
        <Show when={props.resolved}>
          <Icon name="circle-check" size="small" class="am-pr-comment-check" />
        </Show>
        <PRAvatar avatar={props.comment.avatar} author={props.comment.author} />
        <span class="am-pr-comment-author">{props.comment.author}</span>
        <Show when={props.inline}>
          <span class="am-pr-comment-tag am-pr-comment-source">
            <Icon name="github" size="small" />
            {t("agentManager.import.pullRequest")}
          </span>
        </Show>
        <Show when={!props.inline || !props.open}>
          <span class="am-pr-comment-preview">{preview(props.comment.body)}</span>
        </Show>
        <div class="am-pr-comment-tags">
          <Show when={props.comment.outdated}>
            <span class="am-pr-comment-tag">{t("agentManager.pr.comment.outdated")}</span>
          </Show>
          <Show when={props.inline && props.resolved}>
            <span class="am-pr-comment-tag">{t("agentManager.pr.comment.resolved")}</span>
          </Show>
          <Show when={props.sent}>
            <span class="am-pr-comment-tag am-pr-comment-tag-sent">{t("agentManager.pr.comment.sent")}</span>
          </Show>
          <PRCommentTime time={props.comment.createdAt} />
        </div>
      </button>

      <Show when={props.open}>
        <Content>
          <PRCommentBody comment={props.comment} target={target()} suggestion published={published()} />
          <Show when={props.onReaction}>
            <div class="am-pr-comment-reactions" data-comment-id={props.comment.id}>
              <PRReactions
                reactions={props.reactions ?? props.comment.reactions}
                pending={props.reactionPending}
                onToggle={(content, add) => props.onReaction?.(content, add)}
              />
              <Show when={props.reactionError}>{(err) => <div class="am-pr-comment-error">{err()}</div>}</Show>
            </div>
          </Show>
          <For each={[...replies().keys()]}>
            {(id) => (
              <Show when={replies().get(id)}>
                {(reply) => (
                  <div class="am-pr-comment-reply">
                    <div class="am-pr-comment-reply-head am-pr-row">
                      <PRAvatar avatar={reply().avatar} author={reply().author} />
                      <span class="am-pr-comment-author">{reply().author}</span>
                      <PRCommentTime time={reply().createdAt} />
                    </div>
                    <PRCommentBody comment={reply()} target={target()} suggestion published={published()} />
                    <Show when={reply().id && props.onReplyReaction}>
                      <div class="am-pr-comment-reactions" data-comment-id={reply().id}>
                        <PRReactions
                          reactions={props.replyReactions?.(reply().id!, reply().reactions) ?? reply().reactions}
                          pending={(content) => props.replyReactionPending?.(reply().id!, content) ?? false}
                          onToggle={(content, add) => props.onReplyReaction?.(reply().id!, content, add)}
                        />
                        <Show when={props.replyReactionError?.(reply().id!)}>
                          {(err) => <div class="am-pr-comment-error">{err()}</div>}
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
            )}
          </For>
          <Show when={target() && props.comment.threadId}>
            <PRCommentForm action="reply" {...target()!} threadId={props.comment.threadId} />
          </Show>
          <Show when={props.error}>{(err) => <div class="am-pr-comment-error">{err()}</div>}</Show>
          <div class="am-pr-comment-actions am-pr-row">
            <Button variant="primary" size="small" disabled={props.sent} onClick={props.onSend}>
              {t("agentManager.pr.fixWithKilo")}
            </Button>
            <Show when={target() && props.onToggleResolved}>
              <Button
                variant="secondary"
                size="small"
                class="am-pr-comment-btn"
                disabled={props.pending}
                onClick={props.onToggleResolved}
              >
                <Show when={props.pending}>
                  <Spinner class="am-pr-comment-spinner" />
                </Show>
                {props.resolved ? t("agentManager.pr.comment.unresolve") : t("agentManager.pr.comment.resolve")}
              </Button>
            </Show>
            <span class="am-pr-comment-actions-gap" />
            <CopyButton text={prMarkdown(props.comment)} label={t("agentManager.pr.comment.copy")} />
            <Show when={props.onOpenDiff}>
              <Tooltip value={t("agentManager.pr.comment.showInDiff")} placement="top">
                <IconButton
                  icon="code"
                  size="small"
                  variant="ghost"
                  aria-label={t("agentManager.pr.comment.showInDiff")}
                  onClick={() => props.onOpenDiff?.()}
                />
              </Tooltip>
            </Show>
            <Show when={props.onOpenFile}>
              <Tooltip value={t("agentManager.diff.openFile")} placement="top">
                <IconButton
                  icon="go-to-file"
                  size="small"
                  variant="ghost"
                  aria-label={t("agentManager.diff.openFile")}
                  onClick={() => props.onOpenFile?.()}
                />
              </Tooltip>
            </Show>
            <Show when={props.onOpenUrl}>
              <Tooltip value={t("agentManager.pr.comment.openOnGitHub")} placement="top">
                <IconButton
                  icon="square-arrow-top-right"
                  size="small"
                  variant="ghost"
                  aria-label={t("agentManager.pr.comment.openOnGitHub")}
                  onClick={() => props.onOpenUrl?.()}
                />
              </Tooltip>
            </Show>
          </div>
        </Content>
      </Show>
      <div class="am-pr-comment-footer">
        <Button
          data-action="toggle-thread"
          variant="ghost"
          size="small"
          aria-expanded={props.open}
          onClick={props.onToggleOpen}
        >
          <Icon name="chevron-down" class={props.open ? "am-pr-comment-collapse-icon" : undefined} size="small" />
          {t(props.open ? "agentManager.pr.comment.collapseThread" : "agentManager.pr.comment.expandThread")}
        </Button>
      </div>
    </div>
  )
}
