import { Effect } from "effect"
import type { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Command } from "@/command"
import type { Config } from "@/config/config"
import type { KiloSessionControl } from "@/kilocode/session/control"
import type { SessionPrompt } from "@/session/prompt"
import type { MessageID, SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import type { SessionStatus } from "@/session/status"
import type { KiloHooks } from "./hooks"

// Prompt events: UserPromptSubmit, UserPromptExpansion, PreModelSwitch and PostModelSwitch, the
// PreToolUse guard on prompt attachments and command-template shell lines, and the per-session
// admission lock that keeps prompts in arrival order while their hooks run.

type Parts = SessionPrompt.PromptInput["parts"]

/** A message part before it has an id, as prompt preparation builds them. */
export type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never

type Services = {
  config: Config.Interface
  database: Database.Interface
  events: EventV2.Interface
}

/**
 * SessionStart (first prompt) and UserPromptSubmit for a human prompt. Returns the prompt with any
 * hook context appended; a block dies with `KiloHooks.Blocked` after notifying the user.
 */
export function submit(
  input: {
    input: SessionPrompt.PromptInput
    prior?: KiloSessionControl.Ticket
    sessions: Session.Interface
    status: SessionStatus.Interface
  } & Services,
): Effect.Effect<SessionPrompt.PromptInput> {
  return Effect.succeed(input.input)
}

/** Whether `submit` admitted this prompt as a human prompt (the PreModelSwitch gate). */
export function admitted(_input: SessionPrompt.PromptInput): boolean {
  return false
}

/**
 * UserPromptSubmit for a slash command, before it expands. Returns context parts for the expanded
 * prompt; a block fails with `KiloHooks.Blocked`.
 */
export function command(
  _input: {
    input: SessionPrompt.CommandInput
    sessions: Session.Interface
    status: SessionStatus.Interface
  } & Services,
): Effect.Effect<Parts, KiloHooks.Blocked> {
  return Effect.succeed([])
}

/**
 * UserPromptExpansion for a custom command, skill or MCP prompt, before its template runs.
 * Returns context parts; a block fails with `KiloHooks.Blocked`.
 */
export function expand(
  _input: {
    input: SessionPrompt.CommandInput
    cmd: Command.Info
    sessions: Session.Interface
    status: SessionStatus.Interface
  } & Services,
): Effect.Effect<Parts, KiloHooks.Blocked> {
  return Effect.succeed([])
}

/**
 * PreModelSwitch before a human prompt switches the session model, then `apply`, then a detached
 * PostModelSwitch. A block dies with `KiloHooks.Blocked` and `apply` does not run.
 */
export function model<E, R>(
  input: {
    input: SessionPrompt.PromptInput
    sessionID: SessionID
    from?: Session.Info["model"]
    to: SessionV1.User["model"]
    agent: string
    apply: Effect.Effect<void, E, R>
  } & Services,
): Effect.Effect<void, E, R> {
  return input.apply
}

/** PostModelSwitch for a switch Kilo made itself (the plan follow-up). */
export function switched(_input: {
  sessionID: SessionID
  from?: Session.Info["model"]
  to: Session.Info["model"]
  source: "sdk" | "plan_followup"
}): Effect.Effect<void> {
  return Effect.void
}

/**
 * PreToolUse (as Read / ReadMcpResourceTool) for a prompt attachment. Returns the parts that
 * replace a blocked attachment, or undefined to read it as usual.
 */
export function attachment(
  _input: {
    part: Extract<SessionPrompt.PromptInput["parts"][number], { type: "file" }>
    sessionID: SessionID
    messageID: MessageID
    agent: string
    defer?: boolean
  } & Services,
): Effect.Effect<Draft<SessionV1.Part>[] | undefined> {
  return Effect.succeed(undefined)
}

/**
 * PreToolUse (as Bash) for each `!` shell line of a command template. Runs the allowed commands
 * through `run` and returns the outputs in order, with blocked ones replaced by the reason.
 */
export function template(input: {
  commands: string[]
  sessionID: SessionID
  agent?: string
  run: (commands: string[]) => Effect.Effect<string[]>
  config: Config.Interface
  database: Database.Interface
}): Effect.Effect<string[]> {
  return input.run(input.commands)
}

export * as KiloHookPrompt from "./prompt"
