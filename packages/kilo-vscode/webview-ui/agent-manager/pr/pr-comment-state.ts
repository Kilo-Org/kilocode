/**
 * PR panel view state, held outside the components that render it.
 *
 * Anything that briefly clears the PR status remounts the panel: a poll that
 * cannot reach `gh`, a reselect, a side panel toggle. Component-local state
 * dies with that remount, which closes threads the user opened and sends the
 * scroll back to the top. Keying by worktree also means leaving a worktree and
 * returning restores the threads that were open there.
 */
import { createSignal, onCleanup } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../../src/types/messages"
import { PR_REACTION_CONTENT, type PRReaction, type PRReactionContent } from "./pr-types"

export interface CommentState {
  /** threadId -> expansion override; the default follows resolved/outdated. */
  expanded: Record<string, boolean>
  /** threadId -> already handed to the agent. */
  sent: Record<string, boolean>
  /** threadId -> resolved state the user asked for, until a poll confirms it. */
  pending: Record<string, boolean>
  /** threadId -> message from a resolve that failed. */
  errors: Record<string, string>
  /** commentId + reaction -> that one reaction is in flight. */
  reactionPending: Record<string, boolean>
  /** commentId + reaction -> the state the user picked, until a poll reports it. */
  reactionPicked: Record<string, boolean>
  /** commentId -> message from a reaction mutation that failed. */
  reactionErrors: Record<string, string>
  /** commentId -> dismissed locally without sending. */
  dismissed: Record<string, boolean>
  /** commit group id (first commit) -> expanded. */
  commitsOpen: Record<string, boolean>
  open: boolean
  doneOpen: boolean
  conversationOpen: boolean
  checksOpen: boolean
  checkGroups: Record<string, boolean>
}

export interface CommentAnchor {
  id: string
  offset: number
}

const BLANK: CommentState = Object.freeze({
  expanded: {},
  sent: {},
  pending: {},
  errors: {},
  reactionPending: {},
  reactionPicked: {},
  reactionErrors: {},
  dismissed: {},
  commitsOpen: {},
  open: true,
  doneOpen: false,
  conversationOpen: true,
  checksOpen: true,
  checkGroups: {},
})

const [all, setAll] = createSignal<Record<string, CommentState>>({})

export function commentState(worktree: string): CommentState {
  return all()[worktree] ?? BLANK
}

export function patchCommentState(worktree: string, patch: (prev: CommentState) => Partial<CommentState>): void {
  setAll((prev) => {
    const current = prev[worktree] ?? BLANK
    return { ...prev, [worktree]: { ...current, ...patch(current) } }
  })
}

export interface ReactionController {
  enabled: () => boolean
  pending: (id: string, content: PRReactionContent) => boolean
  error: (id: string) => string | undefined
  /** Polled reactions with the user's unconfirmed pick applied. */
  list: (id: string, reactions?: PRReaction[]) => PRReaction[]
  toggle: (id: string, content: PRReactionContent, add: boolean) => void
}

interface ReactionOptions {
  worktree: () => string | undefined
  project: () => string | undefined
  post: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
  fail: (error?: string) => string
}

export function createReactionController(opts: ReactionOptions): ReactionController {
  const key = () => opts.worktree() ?? ""
  const enabled = () => opts.worktree() != null
  const pending = (id: string, content: PRReactionContent) =>
    reactionKey(id, content) in commentState(key()).reactionPending
  const error = (id: string) => commentState(key()).reactionErrors[id]

  /**
   * Applied on read instead of written into the polled data, so it stays right
   * when a poll lands mid-flight and turns into a no-op once the server agrees.
   */
  const list = (id: string, reactions?: PRReaction[]) => {
    const state = commentState(key())
    const picked = state.reactionPicked
    const merged = (reactions ?? []).flatMap((item) => {
      const choice = picked[reactionKey(id, item.content)]
      if (choice === undefined || choice === item.viewerHasReacted) return [item]
      const count = choice ? item.count + 1 : item.count - 1
      // The last reaction removed keeps its pill while the request runs, so the
      // spinner has somewhere to show and the pill is not rebuilt on failure.
      const keep = count > 0 || reactionKey(id, item.content) in state.reactionPending
      return keep ? [{ ...item, count: Math.max(count, 0), viewerHasReacted: choice }] : []
    })
    for (const content of PR_REACTION_CONTENT) {
      const pick = reactionKey(id, content)
      const removing = state.reactionPending[pick] === false
      if (picked[pick] !== true && !removing) continue
      if (merged.some((item) => item.content === content)) continue
      merged.push({ content, count: removing ? 0 : 1, viewerHasReacted: !removing })
    }
    // Enum order, so a pill keeps its place when a pick or a poll lands.
    return merged.sort((a, b) => PR_REACTION_CONTENT.indexOf(a.content) - PR_REACTION_CONTENT.indexOf(b.content))
  }

  const toggle = (id: string, content: PRReactionContent, add: boolean) => {
    const worktree = opts.worktree()
    if (!worktree || pending(id, content)) return
    opts.post({
      type: "agentManager.commentReaction",
      projectId: opts.project(),
      worktreeId: worktree,
      commentId: id,
      reaction: content,
      add,
    })
    patchCommentState(worktree, (prev) => ({
      reactionPending: { ...prev.reactionPending, [reactionKey(id, content)]: add },
      reactionPicked: { ...prev.reactionPicked, [reactionKey(id, content)]: add },
      reactionErrors: omit(prev.reactionErrors, id),
    }))
  }
  const release = opts.onMessage((msg) => {
    if (msg.type !== "agentManager.commentReactionResult") return
    if (msg.worktreeId !== opts.worktree()) return
    const project = opts.project()
    if (project && msg.projectId !== project) return
    const pick = reactionKey(msg.commentId, msg.reaction)
    patchCommentState(msg.worktreeId, (prev) => ({
      reactionPending: omit(prev.reactionPending, pick),
      // A pick that landed stays until a poll reports it, so the pill does not
      // drop back to the old count in between.
      reactionPicked: msg.success
        ? prev.reactionPicked
        : msg.add
          ? omit(prev.reactionPicked, pick)
          : { ...prev.reactionPicked, [pick]: true },
      reactionErrors: msg.success
        ? omit(prev.reactionErrors, msg.commentId)
        : { ...prev.reactionErrors, [msg.commentId]: opts.fail(msg.error) },
    }))
  })
  onCleanup(release)
  return { enabled, pending, error, list, toggle }
}

function reactionKey(id: string, content: PRReactionContent): string {
  return `${id}\u0000${content}`
}

export function omit<T>(map: Record<string, T>, id: string): Record<string, T> {
  const next = { ...map }
  delete next[id]
  return next
}

/**
 * Scroll position, deliberately not reactive: it is written on every scroll
 * frame, and a signal would re-render every card that reads thread state.
 */
const positions = new Map<string, { scroll: number; anchor?: CommentAnchor }>()

export function commentScroll(worktree: string): { scroll: number; anchor?: CommentAnchor } | undefined {
  return positions.get(worktree)
}

export function setCommentScroll(worktree: string, scroll: number, anchor?: CommentAnchor): void {
  positions.set(worktree, { scroll, anchor })
}
