import { randomUUID } from "crypto"
import type { MessageID, SessionID } from "@/session/schema"

export namespace BackgroundTask {
  export type TaskID = string
  export type Status = "queued" | "running" | "completed" | "failed" | "cancelled"

  export interface Failure {
    name?: string
    message: string
  }

  export interface Info {
    taskID: TaskID
    parentSessionID: SessionID
    childSessionID: SessionID
    childUserMessageID: MessageID
    generation: number
    status: Status
    createdAt: number
    startedAt: number | undefined
    completedAt: number | undefined
    resultMessageID: MessageID | undefined
    error: Failure | undefined
  }

  interface Entry extends Info {
    ownerToken: symbol
  }

  export interface Claim {
    taskID: TaskID
    generation: number
    ownerToken: symbol
  }

  export interface CreateInput {
    taskID?: TaskID
    parentSessionID: SessionID
    childSessionID: SessionID
    childUserMessageID: MessageID
    now?: number
  }

  export interface CreateResult {
    info: Info
    claim: Claim
  }

  export interface TransitionResult {
    applied: boolean
    info: Info | undefined
  }

  interface Time {
    now?: number
  }

  export interface RunningInput extends Claim, Time {}

  export interface CompletedInput extends Claim, Time {
    resultMessageID: MessageID
  }

  export interface FailedInput extends Claim, Time {
    error: unknown
  }

  export interface CancelledInput extends Claim, Time {}

  const entries = new Map<TaskID, Entry>()

  const live = (status: Status) => status === "queued" || status === "running"

  const copyFailure = (input: Failure | undefined): Failure | undefined => {
    if (!input) return undefined
    return {
      ...(input.name ? { name: input.name } : {}),
      message: input.message,
    }
  }

  const view = (entry: Entry): Info => ({
    taskID: entry.taskID,
    parentSessionID: entry.parentSessionID,
    childSessionID: entry.childSessionID,
    childUserMessageID: entry.childUserMessageID,
    generation: entry.generation,
    status: entry.status,
    createdAt: entry.createdAt,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    resultMessageID: entry.resultMessageID,
    error: copyFailure(entry.error),
  })

  const result = (applied: boolean, entry?: Entry): TransitionResult => ({
    applied,
    info: entry ? view(entry) : undefined,
  })

  const makeID = () => `bg_${randomUUID()}`

  const owns = (entry: Entry, claim: Claim) =>
    entry.ownerToken === claim.ownerToken && entry.generation === claim.generation

  const current = (taskID: TaskID) => entries.get(taskID)

  const object = (input: unknown): input is Record<string, unknown> => typeof input === "object" && input !== null

  function failure(input: unknown): Failure {
    if (input instanceof Error) {
      return {
        name: input.name,
        message: input.message,
      }
    }

    if (object(input)) {
      const message = typeof input.message === "string" ? input.message : String(input)
      const name = typeof input.name === "string" ? input.name : undefined
      return {
        ...(name ? { name } : {}),
        message,
      }
    }

    return {
      message: String(input),
    }
  }

  function transition<T extends Claim & Time>(
    input: T,
    allow: (status: Status) => boolean,
    apply: (entry: Entry, next: T) => void,
  ): TransitionResult {
    const entry = current(input.taskID)
    if (!entry) return result(false)
    if (!owns(entry, input)) return result(false, entry)
    if (!allow(entry.status)) return result(false, entry)
    apply(entry, input)
    return result(true, entry)
  }

  export function create(input: CreateInput): CreateResult {
    const taskID = input.taskID ?? makeID()
    if (taskID === input.childSessionID) {
      throw new Error(`Background task handle must differ from child session: ${taskID}`)
    }

    const prev = current(taskID)
    if (prev && live(prev.status)) {
      throw new Error(`Background task already active: ${taskID}`)
    }
    if (prev && prev.parentSessionID !== input.parentSessionID) {
      throw new Error(`Background task parent mismatch: ${taskID}`)
    }

    const entry: Entry = {
      taskID,
      parentSessionID: input.parentSessionID,
      childSessionID: input.childSessionID,
      childUserMessageID: input.childUserMessageID,
      generation: prev ? prev.generation + 1 : 1,
      ownerToken: Symbol(taskID),
      status: "queued",
      createdAt: input.now ?? Date.now(),
      startedAt: undefined,
      completedAt: undefined,
      resultMessageID: undefined,
      error: undefined,
    }
    entries.set(taskID, entry)

    return {
      info: view(entry),
      claim: {
        taskID: entry.taskID,
        generation: entry.generation,
        ownerToken: entry.ownerToken,
      },
    }
  }

  export function get(taskID: TaskID) {
    const entry = current(taskID)
    if (!entry) return undefined
    return view(entry)
  }

  export function list(input?: { parentSessionID?: SessionID }) {
    return [...entries.values()]
      .filter((entry) => !input?.parentSessionID || entry.parentSessionID === input.parentSessionID)
      .map(view)
  }

  export function transitionToRunning(input: RunningInput) {
    return transition(
      input,
      (status) => status === "queued",
      (entry, next) => {
        entry.status = "running"
        entry.startedAt = next.now ?? Date.now()
      },
    )
  }

  export function transitionToCompleted(input: CompletedInput) {
    return transition(
      input,
      (status) => status === "running",
      (entry, next) => {
        entry.status = "completed"
        entry.completedAt = next.now ?? Date.now()
        entry.resultMessageID = next.resultMessageID
        entry.error = undefined
      },
    )
  }

  export function transitionToFailed(input: FailedInput) {
    return transition(
      input,
      (status) => status === "queued" || status === "running",
      (entry, next) => {
        entry.status = "failed"
        entry.completedAt = next.now ?? Date.now()
        entry.resultMessageID = undefined
        entry.error = failure(next.error)
      },
    )
  }

  export function transitionToCancelled(input: CancelledInput) {
    return transition(
      input,
      (status) => status === "queued" || status === "running",
      (entry, next) => {
        entry.status = "cancelled"
        entry.completedAt = next.now ?? Date.now()
        entry.resultMessageID = undefined
        entry.error = undefined
      },
    )
  }

  /** @internal Exported for tests. */
  export function resetForTests() {
    entries.clear()
  }
}
