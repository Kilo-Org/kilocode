// Subagent steering from the TUI.
//
// A subagent view mounts the normal prompt so the user can redirect a running
// child. Every path that sends input to the child (prompt, slash command, shell)
// must use the child's own agent and model: sending the primary selection would
// run the child as the primary agent, and the server persists that choice onto
// the child session. Plain prompts also mark the typed text so the server can
// tell a human steer apart from the parent's own task-tool prompt and notify the
// parent over the shared agent board.
import type { Session } from "@kilocode/sdk/v2"
import { running } from "../util/session"

// Must match `KIND` in packages/opencode/src/kilocode/session/steering.ts.
export const KIND = "subagent_steer"

type Target = Pick<Session, "parentID" | "agent" | "model"> | undefined
type Ref = { focused: boolean; current: { input: string } } | undefined

function child(session: Target) {
  return session?.parentID ? session : undefined
}

function pick(session: Target) {
  const target = child(session)
  if (!target) return undefined
  const variant = target.model?.variant
  return {
    agent: target.agent,
    model: target.model,
    variant: variant && variant !== "default" ? variant : undefined,
  }
}

/** Whether `session` is a subagent that the TUI prompt would steer. */
export function steering(session: Target) {
  return !!child(session)
}

/** Subagent views accept input only while the child runs; a finished child's new turn never reaches the parent. */
export function open(session: Target, status: string | undefined) {
  return !child(session) || running(status ?? "idle")
}

/** Subagent navigation keys yield to the prompt once the user starts typing a steer. */
export function nav(ref: Ref) {
  return !ref?.focused || ref.current.input === ""
}

/** Metadata that marks the typed text part as a human steer. */
export function mark(session: Target) {
  return child(session) ? { metadata: { kind: KIND } } : {}
}

/** `session.prompt` overrides that keep the child's agent, model, and variant. */
export function prompt(session: Target) {
  const target = pick(session)
  if (!target) return {}
  return {
    ...(target.agent ? { agent: target.agent } : {}),
    ...(target.model ? { model: { providerID: target.model.providerID, modelID: target.model.id } } : {}),
    variant: target.variant,
  }
}

/** `session.command` overrides that keep the child's agent, model, and variant. */
export function command(session: Target) {
  const target = pick(session)
  if (!target) return {}
  return {
    ...(target.agent ? { agent: target.agent } : {}),
    ...(target.model ? { model: `${target.model.providerID}/${target.model.id}` } : {}),
    variant: target.variant,
  }
}

/** `session.shell` overrides that keep the child's agent and model. */
export function shell(session: Target) {
  const target = pick(session)
  if (!target) return {}
  return {
    ...(target.agent ? { agent: target.agent } : {}),
    ...(target.model ? { model: { providerID: target.model.providerID, modelID: target.model.id } } : {}),
  }
}

export * as KiloSteer from "./steer"
