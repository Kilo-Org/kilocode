/**
 * PR panel view state, held outside the components that render it.
 *
 * Anything that briefly clears the PR status remounts the panel: a poll that
 * cannot reach `gh`, a reselect, a side panel toggle. Component-local state
 * dies with that remount, which closes threads the user opened and sends the
 * scroll back to the top. Keying by worktree also means leaving a worktree and
 * returning restores the threads that were open there.
 */
import { createSignal } from "solid-js"

export interface CommentState {
  /** threadId -> expansion override; the default follows resolved/outdated. */
  expanded: Record<string, boolean>
  /** threadId -> already handed to the agent. */
  sent: Record<string, boolean>
  /** threadId -> resolved state the user asked for, until a poll confirms it. */
  pending: Record<string, boolean>
  /** threadId -> message from a resolve that failed. */
  errors: Record<string, string>
  open: boolean
  doneOpen: boolean
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
  open: true,
  doneOpen: false,
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
