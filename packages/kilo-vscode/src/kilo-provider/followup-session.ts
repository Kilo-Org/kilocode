import { normalizePath } from "../agent-manager/git-import"

const TTL = 30_000
const LABEL = "Start new session"

export interface Followup {
  dir: string
  time: number
}

export function recordFollowup(input: { answers: string[][]; dir: string; now: number }): Followup | undefined {
  const answer = input.answers[0]?.[0]?.trim()
  if (answer !== LABEL) return
  return {
    dir: input.dir,
    time: input.now,
  }
}

export function matchFollowup(input: { pending: Followup | null; dir: string; now: number }): boolean {
  const item = input.pending
  if (!item) return false
  if (input.now - item.time > TTL) return false
  return normalizePath(item.dir) === normalizePath(input.dir)
}
