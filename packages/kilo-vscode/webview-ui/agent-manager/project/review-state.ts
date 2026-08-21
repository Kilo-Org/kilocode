import type { ReviewComment } from "../../src/types/messages"
import { createSignal } from "solid-js"

export function createReviewState() {
  const [open, setOpen] = createSignal<Record<string, boolean>>({})
  const [comments, setComments] = createSignal<Record<string, ReviewComment[]>>({})
  return { open, setOpen, comments, setComments }
}

export function reviewKey(project: string, context: string): string {
  return `${project}:${context}`
}

export function reviewOpen(values: Record<string, boolean>, project: string, context: string): boolean {
  return values[reviewKey(project, context)] === true
}

export function setReviewOpen(
  values: Record<string, boolean>,
  project: string,
  context: string,
  open: boolean,
): Record<string, boolean> {
  const key = reviewKey(project, context)
  if (values[key] === open) return values
  return { ...values, [key]: open }
}

export function reviewComments(
  values: Record<string, ReviewComment[]>,
  project: string,
  context: string,
): ReviewComment[] {
  return values[reviewKey(project, context)] ?? []
}

export function setReviewComments(
  values: Record<string, ReviewComment[]>,
  project: string,
  context: string,
  comments: ReviewComment[],
): Record<string, ReviewComment[]> {
  return { ...values, [reviewKey(project, context)]: comments }
}

export function pruneReviewState<T>(
  values: Record<string, T>,
  project: string,
  contexts: Set<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => {
      const [owner, context] = key.split(":")
      return owner !== project || context === "local" || contexts.has(context)
    }),
  )
}
