/**
 * a2a-task.ts — A2A Protocol task lifecycle state machine
 * Spec: https://a2a-protocol.org/v1.0.0/specification/
 * Deps: none
 */

export type TaskState =
  | "submitted" | "working" | "input-required" | "auth-required"
  | "completed" | "failed" | "canceled" | "rejected"

export interface A2ATask {
  id: string; state: TaskState; createdAt: number; updatedAt: number
}

export interface TaskSend { kind: "send"; taskId: string; payload: unknown }
export interface TaskSubscribe { kind: "subscribe"; taskId: string }
export interface TaskCancel { kind: "cancel"; taskId: string }
export type TaskMessage = TaskSend | TaskSubscribe | TaskCancel

const TERMINALS: TaskState[] = ["completed", "failed", "canceled", "rejected"]
export const isTerminal = (s: TaskState) => TERMINALS.includes(s)

const TRANSITIONS: Record<string, TaskState[]> = {
  submitted: ["working", "input-required", "auth-required", "rejected", "canceled"],
  working: ["completed", "failed", "input-required", "auth-required", "canceled"],
  "input-required": ["working", "canceled", "rejected"],
  "auth-required": ["working", "canceled", "rejected"],
}

export function createTask(id: string): A2ATask {
  return { id, state: "submitted", createdAt: Date.now(), updatedAt: Date.now() }
}

export function transition(task: A2ATask, next: TaskState): A2ATask {
  if (isTerminal(task.state)) throw new Error(`Task ${task.id} already terminal: ${task.state}`)
  const allowed = TRANSITIONS[task.state] ?? []
  if (!allowed.includes(next)) throw new Error(`Invalid: ${task.state} -> ${next}`)
  return { ...task, state: next, updatedAt: Date.now() }
}

export function handleMessage(tasks: Map<string, A2ATask>, msg: TaskMessage): Map<string, A2ATask> {
  const out = new Map(tasks)
  const t = out.get(msg.taskId)
  if (!t) return out
  if (msg.kind === "cancel") out.set(t.id, transition(t, "canceled"))
  if (msg.kind === "send" && t.state === "input-required")
    out.set(t.id, transition(t, "working"))
  return out
}
