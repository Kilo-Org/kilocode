/** @jsxImportSource solid-js */
import { For, Match, Show, Switch, createMemo } from "solid-js"
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
import type {
  PRCommitItem,
  PRConversationComment,
  PREventItem,
  PREventKind,
  PRReaction,
  PRReactionContent,
  PRTimelineItem,
  ReviewerState,
} from "./pr-types"
import { PRReactions } from "./PRReactions"
import { PRCommentForm } from "./PRCommentForm"
import { PRDescription } from "./PRDescription"
import { PRTimelineRow } from "./PRTimelineRow"

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

const EVENT_ICON: Record<PREventKind, string> = {
  merged: "git-merge",
  closed: "circle-x-outline",
  reopened: "circle-check",
  force_pushed: "arrow-right",
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

function CommitRow(props: { commit: PRCommitItem; onOpenUrl?: (url: string) => void }) {
  const href = () => githubUrl(props.commit.url)
  const open = () => {
    const url = href()
    if (url) props.onOpenUrl?.(url)
  }
  return (
    <div class="am-pr-timeline-row am-pr-row" data-timeline-row>
      <Icon name="git-commit" size="small" class="am-pr-timeline-icon" />
      <Show when={href() && props.onOpenUrl} fallback={<span class="am-pr-timeline-sha">{props.commit.short}</span>}>
        <button type="button" class="am-pr-timeline-sha am-pr-timeline-link" onClick={open}>
          {props.commit.short}
        </button>
      </Show>
      <span class="am-pr-timeline-label" title={props.commit.message}>
        {props.commit.message}
      </span>
      <PRCommentTime time={props.commit.createdAt} />
    </div>
  )
}

function CommitGroup(props: {
  commits: PRCommitItem[]
  open: boolean
  onToggle: () => void
  onOpenUrl?: (url: string) => void
}) {
  const { t } = useLanguage()
  const count = () => props.commits.length
  const latest = () => props.commits.at(-1)
  return (
    <Show when={count() > 1} fallback={<CommitRow commit={props.commits[0]!} onOpenUrl={props.onOpenUrl} />}>
      <div class="am-pr-timeline-group">
        <button
          type="button"
          class="am-pr-timeline-row am-pr-row am-pr-timeline-toggle"
          data-timeline-row
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="am-pr-timeline-chevron" />
          <Icon name="git-commit" size="small" class="am-pr-timeline-icon" />
          <span class="am-pr-timeline-label">
            {t("agentManager.pr.timeline.commits", { author: props.commits[0]!.author, count: count() })}
          </span>
          <PRCommentTime time={latest()?.createdAt} />
        </button>
        <Show when={props.open}>
          <div class="am-pr-timeline-children">
            <For each={props.commits}>{(commit) => <CommitRow commit={commit} onOpenUrl={props.onOpenUrl} />}</For>
          </div>
        </Show>
      </div>
    </Show>
  )
}

function EventRow(props: { item: PREventItem }) {
  const { t } = useLanguage()
  const label = () => {
    const item = props.item
    switch (item.event) {
      case "merged":
        return t("agentManager.pr.timeline.merged", { actor: item.actor, branch: item.detail ?? "" })
      case "closed":
        return t("agentManager.pr.timeline.closed", { actor: item.actor })
      case "reopened":
        return t("agentManager.pr.timeline.reopened", { actor: item.actor })
      case "force_pushed":
        return t("agentManager.pr.timeline.forcePushed", { actor: item.actor, detail: item.detail ?? "" })
    }
  }
  return <PRTimelineRow icon={EVENT_ICON[props.item.event]} label={label()} time={props.item.createdAt} />
}

function ReviewRow(props: { comment: PRConversationComment }) {
  const { t } = useLanguage()
  const key = () =>
    props.comment.state === "approved"
      ? "agentManager.pr.timeline.approved"
      : props.comment.state === "changes_requested"
        ? "agentManager.pr.timeline.changesRequested"
        : "agentManager.pr.timeline.commented"
  return (
    <PRTimelineRow
      icon={REVIEWER_ICON[props.comment.state ?? "commented"]}
      label={t(key(), { author: props.comment.author })}
      time={props.comment.createdAt}
    />
  )
}

interface Group {
  id: string
  comment?: PRConversationComment
  commits?: PRCommitItem[]
  event?: PREventItem
}

/** Consecutive commits by the same author collapse into one expandable group. */
function groupItems(items: PRTimelineItem[]): Group[] {
  const groups: Group[] = []
  for (const item of items) {
    if (item.kind === "commit") {
      const last = groups.at(-1)
      if (last?.commits && last.commits[0]!.author === item.author) {
        last.commits.push(item)
        continue
      }
      groups.push({ id: item.id, commits: [item] })
      continue
    }
    if (item.kind === "event") {
      groups.push({ id: item.id, event: item })
      continue
    }
    groups.push({ id: item.id, comment: item })
  }
  return groups
}

interface Props {
  prNumber: number
  prUrl: string
  items: PRTimelineItem[]
  hasEarlier?: boolean
  description?: string
  author?: string
  createdAt?: number
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
  const index = createMemo(() => new Map(groupItems(props.items).map((group) => [group.id, group])))
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

  const toggleCommits = (id: string) => {
    const next = !(state().commitsOpen[id] ?? false)
    patch((prev) => ({ commitsOpen: { ...prev.commitsOpen, [id]: next } }))
  }

  const actionable = createMemo(() => actionableConversation(props.items, state()))

  function send(ids: string[]) {
    sendConversation(props.worktreeId, props.items, ids, state(), props.activeTerminalId)
  }

  const earlier = () => {
    const url = githubUrl(props.prUrl)
    return url && props.onOpenUrl ? () => props.onOpenUrl?.(url) : undefined
  }

  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading
          title={t("agentManager.pr.conversation.title")}
          open={open()}
          onToggle={() => setOpen(!open())}
          count={props.items.length > 0 ? String(props.items.length) : undefined}
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
          <Show when={props.description}>
            {(body) => <PRDescription body={body()} author={props.author} createdAt={props.createdAt} />}
          </Show>
          <Show when={props.hasEarlier}>
            <PRTimelineRow icon="history" label={t("agentManager.pr.timeline.earlier")} onClick={earlier()} />
          </Show>
          <div class="am-pr-panel-comment-list am-pr-col">
            <For each={[...index().keys()]}>
              {(id) => (
                <Show when={index().get(id)}>
                  {(group) => (
                    <Switch>
                      <Match when={group().comment}>
                        {(comment) => (
                          <Show
                            when={comment().kind === "review" && !comment().body.trim()}
                            fallback={
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
                            }
                          >
                            <ReviewRow comment={comment()} />
                          </Show>
                        )}
                      </Match>
                      <Match when={group().commits}>
                        {(commits) => (
                          <CommitGroup
                            commits={commits()}
                            open={state().commitsOpen[id] ?? false}
                            onToggle={() => toggleCommits(id)}
                            onOpenUrl={props.onOpenUrl}
                          />
                        )}
                      </Match>
                      <Match when={group().event}>{(event) => <EventRow item={event()} />}</Match>
                    </Switch>
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
