// Subagent steering from the TUI.
//
// A subagent view mounts the normal prompt so the user can redirect a running
// child with plain steering prompts only: shell mode and slash commands are off
// there. A steer uses the child's own agent and model, since sending the primary
// selection would run the child as the primary agent and the server persists
// that choice onto the child session. The typed text is also marked so the
// server can tell a human steer apart from the parent's own task-tool prompt and
// notify the parent over the shared agent board.
import type { Session } from "@kilocode/sdk/v2"
import { running } from "../util/session"
import { KiloTaskPause } from "./task-pause"

// Must match `KIND` in packages/opencode/src/kilocode/session/steering.ts.
export const KIND = "subagent_steer"

type Target = Pick<Session, "parentID" | "agent" | "model" | "metadata"> | undefined
type Ref = { focused: boolean; current: { input: string } } | undefined

function child(session: Target) {
  return session?.parentID ? session : undefined
}

/**
 * The steered subagent's agent name: recorded on the session, else its latest reply, else the
 * task-tool title (`inspect bug (@general subagent)`), the same title the subagent footer reads.
 */
export function agent(session: Pick<Session, "agent" | "title"> | undefined, last?: string) {
  return session?.agent ?? last ?? session?.title.match(/@(\w+) subagent/)?.[1]
}

type Provider = { id: string; name: string; models: Record<string, { name: string } | undefined> }

/** Display names for the steered subagent's model, falling back to raw ids. */
export function model(ref: Session["model"], providers: readonly Provider[]) {
  if (!ref) return undefined
  const provider = providers.find((item) => item.id === ref.providerID)
  return { name: provider?.models[ref.id]?.name ?? ref.id, provider: provider?.name ?? ref.providerID }
}

/** Whether `session` is a subagent that the TUI prompt would steer. */
export function steering(session: Target) {
  return !!child(session)
}

/**
 * Subagent views accept input while the child runs, and while its task is paused by an
 * interrupt, where the prompt resumes the task. A finished child's new turn never reaches the parent.
 */
export function open(session: Target, status: string | undefined) {
  return !child(session) || running(status ?? "idle") || KiloTaskPause.paused(session)
}

/**
 * Whether subagent-view keys (arrow navigation, double-press exit) act on the view: true
 * unless the user is typing a steer, so those keys keep their editing meaning in the prompt.
 */
export function idle(ref: Ref) {
  return !ref?.focused || ref.current.input === ""
}

/** Metadata that marks the typed text part as a human steer. */
export function mark(session: Target) {
  return child(session) ? { metadata: { kind: KIND } } : {}
}

/** `session.prompt` overrides that keep the child's agent, model, and variant. */
export function prompt(session: Target) {
  const target = child(session)
  if (!target) return {}
  const variant = target.model?.variant
  return {
    ...(target.agent ? { agent: target.agent } : {}),
    ...(target.model ? { model: { providerID: target.model.providerID, modelID: target.model.id } } : {}),
    variant: variant && variant !== "default" ? variant : undefined,
  }
}

export * as KiloSteer from "./steer"
