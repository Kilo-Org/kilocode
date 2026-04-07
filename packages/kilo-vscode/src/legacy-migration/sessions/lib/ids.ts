import { createHash } from "node:crypto"

export function createProjectID(worktree?: string) {
  return hash(worktree ?? "")
}

export function createSessionID(id: string) {
  return prefixed("ses", id)
}

export function createMessageID(id: string, index: number) {
  return prefixed("msg", `${id}:${index}`)
}

export function createPartID(id: string, index: number, part: number) {
  return prefixed("prt", `${id}:${index}:${part}`)
}

export function createExtraPartID(id: string, index: number, kind: string) {
  return prefixed("prt", `${id}:${index}:${kind}`)
}

function prefixed(prefix: string, value: string) {
  return `${prefix}_migrated_${hash(value).slice(0, 26)}`
}

function hash(value: string) {
  return createHash("sha1").update(value).digest("hex")
}
