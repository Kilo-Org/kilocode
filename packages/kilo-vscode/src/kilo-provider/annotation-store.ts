import { open, mkdir, rename, rm, stat, readFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Flock } from "@opencode-ai/core/util/flock"
import { type Annotation, copyAnnotation, validAnnotation } from "../shared/annotations"

const BYTES = 16 * 1024 * 1024
const SESSIONS = 4096
const TOMBSTONES = 4096
const IDENTITIES = 20_000
const RECORDS = 1000
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Conversation {
  high: number
  revision: number
  deleted?: boolean
  items: Annotation[]
  removed: Record<string, number>
}
interface State {
  version: 1
  sessions: Record<string, Conversation>
}

const empty = (): Conversation => ({ high: 0, revision: 0, items: [], removed: {} })
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

function conversation(id: string, record: Conversation) {
  if (
    !id ||
    id.length > 512 ||
    !record ||
    !count(record.high) ||
    !count(record.revision) ||
    (record.deleted !== undefined && typeof record.deleted !== "boolean") ||
    !Array.isArray(record.items) ||
    record.items.length > RECORDS ||
    !record.removed ||
    typeof record.removed !== "object" ||
    Array.isArray(record.removed)
  )
    throw new Error("Invalid annotation conversation. Original data was not replaced.")
}

function identities(id: string, record: Conversation) {
  const identities = new Set<string>()
  const numbers = new Set<number>()
  for (const item of record.items) {
    if (
      !validAnnotation(item) ||
      item.sessionID !== id ||
      !item.number ||
      item.number > record.high ||
      identities.has(item.id) ||
      numbers.has(item.number)
    )
      throw new Error("Invalid annotation numbers. Original data was not replaced.")
    identities.add(item.id)
    numbers.add(item.number)
  }
  for (const [key, number] of Object.entries(record.removed)) {
    if (!key || !count(number) || !number || number > record.high || identities.has(key) || numbers.has(number))
      throw new Error("Invalid deleted annotation numbers. Original data was not replaced.")
    identities.add(key)
    numbers.add(number)
  }
  if (identities.size > IDENTITIES)
    throw new Error("Annotation identity limit reached. Delete the source conversation to remove its records.")
}

function validate(value: unknown): asserts value is State {
  if (!value || typeof value !== "object")
    throw new Error("Invalid annotation storage. Original data was not replaced.")
  const state = value as State
  if (state.version !== 1 || !state.sessions || typeof state.sessions !== "object" || Array.isArray(state.sessions))
    throw new Error("Unsupported annotation storage. Original data was not replaced.")
  const entries = Object.entries(state.sessions)
  const live = entries.filter(([, record]) => !record.deleted)
  if (live.length > SESSIONS) throw new Error("Annotation conversation limit reached.")
  for (const [id, record] of Object.entries(state.sessions)) {
    conversation(id, record)
    identities(id, record)
  }
}

export class AnnotationStore {
  readonly directory: string
  readonly file: string

  constructor(storage: string) {
    this.directory = path.join(storage, "annotations")
    this.file = path.join(this.directory, "records-v1.json")
  }

  private async read(): Promise<State> {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) return { version: 1, sessions: {} }
    if (info.size > BYTES) throw new Error("Annotation storage exceeds 16 MiB. Original data was not replaced.")
    const state: unknown = JSON.parse(await readFile(this.file, "utf8"))
    validate(state)
    return state
  }

  private async write(state: State) {
    validate(state)
    const json = JSON.stringify(state)
    if (Buffer.byteLength(json) > BYTES)
      throw new Error("Annotation storage is full (16 MiB). No records were evicted.")
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, "wx", 0o600)
      try {
        await handle.writeFile(json, "utf8")
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.file)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  private async change(id: string, mutate?: (record: Conversation) => boolean, mutateState?: (state: State) => boolean) {
    if (!id || id.length > 512 || ["__proto__", "constructor", "prototype"].includes(id))
      throw new Error("Invalid source conversation.")
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return Flock.withLock(
      this.file,
      async () => {
        const state = await this.read()
        const record = Object.hasOwn(state.sessions, id) ? state.sessions[id]! : empty()
        const changed = mutate?.(record) ?? false
        if (changed) {
          record.revision++
          state.sessions[id] = record
        }
        const stateChanged = mutateState?.(state) ?? false
        if (changed || stateChanged) await this.write(state)
        return { revision: record.revision, items: record.items.map(copyAnnotation) }
      },
      { dir: this.directory, timeoutMs: 10_000, baseDelayMs: 10, maxDelayMs: 100 },
    )
  }

  load(id: string) {
    return this.change(id)
  }

  save(input: Annotation) {
    if (!validAnnotation(input)) return Promise.reject(new Error("Invalid annotation. Draft was not saved."))
    const item = copyAnnotation(input)
    return this.change(item.sessionID, (record) => {
      if (record.deleted) throw new Error("The source conversation was deleted. Annotation was not saved.")
      if (Object.hasOwn(record.removed, item.id))
        throw new Error("This annotation was deleted in another pane. It cannot be restored with the same identity.")
      const index = record.items.findIndex((value) => value.id === item.id)
      const existing = record.items.at(index < 0 ? record.items.length : index)
      if (existing) {
        if (item.number !== undefined && item.number !== existing.number)
          throw new Error("Annotation number does not match its source conversation.")
        if (
          item.messageID !== existing.messageID ||
          item.selectedText !== existing.selectedText ||
          JSON.stringify(item.anchor) !== JSON.stringify(existing.anchor)
        )
          throw new Error("Annotation source cannot be changed. Create a new annotation instead.")
        item.number = existing.number
        item.createdAt = existing.createdAt
        if (item.comment === existing.comment && item.updatedAt === existing.updatedAt) return false
        if (item.updatedAt <= existing.updatedAt)
          throw new Error("Annotation changed in another pane. Reopen it before editing.")
        record.items[index] = item
        return true
      }
      if (item.number !== undefined)
        throw new Error("The original numbered annotation is unavailable. Its source number was not remapped.")
      if (!uuid.test(item.id)) throw new Error("New annotations require a UUID identity.")
      if (record.items.length >= RECORDS)
        throw new Error("This source conversation has 1,000 annotation marks. No records were evicted.")
      if (record.high >= Number.MAX_SAFE_INTEGER) throw new Error("Annotation number limit reached.")
      item.number = ++record.high
      record.items.push(item)
      return true
    })
  }

  remove(id: string, ids: string[]) {
    return this.change(id, (record) => {
      const removed = record.items.filter((item) => ids.includes(item.id))
      if (!removed.length) return false
      for (const item of removed) record.removed[item.id] = item.number!
      record.items = record.items.filter((item) => !ids.includes(item.id))
      return true
    })
  }

  deleteSession(id: string) {
    return this.change(
      id,
      (record) => {
        if (record.deleted) return false
        record.deleted = true
        record.items = []
        record.removed = {}
        return true
      },
      (state) => {
        const tombstones = Object.entries(state.sessions).filter(([key, record]) => record.deleted && key !== id)
        const excess = tombstones.length + 1 - TOMBSTONES
        if (excess <= 0) return false
        const oldest = tombstones
          .sort((left, right) => left[1].revision - right[1].revision)
          .slice(0, excess)
        for (const [key] of oldest) delete state.sessions[key]
        return true
      },
    )
  }
}
