import { createSignal, type Accessor } from "solid-js"
import type { PromptMentionDrop } from "../hooks/file-mention-utils"

export type { PromptMentionDrop }

/** Drag payload for a session tab or card. Normalizes the title and timestamp. */
export function sessionDrop(session: { id: string; title?: string; updatedAt?: string }): PromptMentionDrop {
  return {
    kind: "session",
    session: {
      id: session.id,
      title: session.title?.trim() || session.id,
      updated: Date.parse(session.updatedAt ?? "") || Date.now(),
    },
  }
}

type Target = {
  element: HTMLElement
  insert: (drop: PromptMentionDrop) => boolean
}

type Point = { x: number; y: number }

type Rect = { left: number; top: number; right: number; bottom: number }

let target: Target | undefined
let active: PromptMentionDrop | undefined
let point: Point | undefined

const [over, setOver] = createSignal(false)
const [dragging, setDragging] = createSignal(false)

export function insideRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

const inside = (x: number, y: number) => {
  const element = target?.element
  if (!element || !element.isConnected) return false
  const rect = element.getBoundingClientRect()
  return insideRect({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, x, y)
}

const move = (event: PointerEvent) => {
  point = { x: event.clientX, y: event.clientY }
  setOver(inside(event.clientX, event.clientY))
}

export function registerPromptMentionDrop(
  element: HTMLElement | undefined,
  insert: ((drop: PromptMentionDrop) => boolean) | undefined,
) {
  target = element && insert ? { element, insert } : undefined
  if (target) return
  // Unmounting mid-drag must not leak the pointer listener or the active drop.
  // Otherwise ordinary pointer movement flips the highlight and keeps the tab
  // constraint loose until an unrelated drag happens to end.
  if (active) {
    document.removeEventListener("pointermove", move)
    active = undefined
    point = undefined
    setDragging(false)
  }
  setOver(false)
}

export function beginPromptMentionDrop(drop: PromptMentionDrop) {
  if (!target) return
  active = drop
  point = undefined
  setOver(false)
  setDragging(true)
  document.addEventListener("pointermove", move)
}

/** Resolve the drop. Returns true when the prompt inserted the mention. */
export function endPromptMentionDrop(): boolean {
  const drop = active
  if (!drop) return false
  document.removeEventListener("pointermove", move)
  const hit = point !== undefined && inside(point.x, point.y)
  const insert = hit ? target?.insert : undefined
  active = undefined
  point = undefined
  setOver(false)
  setDragging(false)
  return insert?.(drop) ?? false
}

export const promptMentionOver: Accessor<boolean> = over
/** True between a prompt mention drag start and its drag end. */
export const promptMentionDragging: Accessor<boolean> = dragging
