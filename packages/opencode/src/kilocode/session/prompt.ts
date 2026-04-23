// kilocode_change - new file
import path from "path"
import fs from "fs/promises"
import { StringDecoder } from "string_decoder"
import { Cause, Exit } from "effect"
import { SessionID, PartID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session"
import { Flag } from "@/flag/flag"
import { PlanFollowup } from "@/kilocode/plan-followup"
import { KiloSession } from "@/kilocode/session"
import { environmentDetails, type EditorContext } from "@/kilocode/editor-context"
import { Identifier } from "@/id/id"
import { Filesystem } from "@/util"
import PROMPT_PLAN from "@/session/prompt/plan.txt"
import CODE_SWITCH from "@/session/prompt/code-switch.txt"

export namespace KiloSessionPrompt {
  /**
   * Determines whether the plan follow-up prompt should be shown.
   * Checks if the plan_exit tool was called in the last assistant turn.
   * Exported so tests can verify the logic independently.
   */
  export function shouldAskPlanFollowup(input: { messages: MessageV2.WithParts[]; abort: AbortSignal }) {
    if (input.abort.aborted) return false
    if (!["cli", "vscode"].includes(Flag.KILO_CLIENT)) return false
    const idx = input.messages.findLastIndex((m) => m.info.role === "user")
    return input.messages
      .slice(idx + 1)
      .some((msg) =>
        msg.parts.some((p) => p.type === "tool" && p.tool === "plan_exit" && p.state.status === "completed"),
      )
  }

  /**
   * Checks for plan follow-up and asks the user if needed.
   * Returns "continue" if the loop should continue, "break" otherwise.
   */
  export async function askPlanFollowup(input: {
    sessionID: SessionID
    messages: MessageV2.WithParts[]
    abort: AbortSignal
  }): Promise<"continue" | "break"> {
    if (!shouldAskPlanFollowup({ messages: input.messages, abort: input.abort })) return "break"
    const action = await PlanFollowup.ask({
      sessionID: input.sessionID,
      messages: input.messages,
      abort: input.abort,
    })
    return action === "continue" ? "continue" : "break"
  }

  export function abortPlanFollowup(sessionID: SessionID) {
    return PlanFollowup.abort(sessionID)
  }

  /**
   * Mutable cache for environment details, keyed by user message ID
   * so it recomputes when a new user message arrives.
   */
  export interface EnvCache {
    block?: string
    user?: string
  }

  /**
   * Ephemerally injects dynamic editor context (visible files, open tabs, etc.)
   * into the last user message. Caches the result per user message ID so repeated
   * loop iterations produce byte-identical messages (prompt caching).
   */
  export function injectEditorContext(input: {
    msgs: MessageV2.WithParts[]
    lastUser: MessageV2.User
    sessionID: SessionID
    cache: EnvCache
  }) {
    if (input.cache.user !== input.lastUser.id) {
      input.cache.block = environmentDetails(input.lastUser.editorContext)
      input.cache.user = input.lastUser.id
    }
    if (!input.cache.block) return
    const idx = input.msgs.findLastIndex((m) => m.info.role === "user")
    if (idx === -1) return
    input.msgs[idx] = {
      ...input.msgs[idx],
      parts: [
        ...input.msgs[idx].parts,
        {
          id: PartID.make(Identifier.ascending("part")),
          sessionID: input.sessionID,
          messageID: input.msgs[idx].info.id,
          type: "text",
          text: input.cache.block,
        } satisfies MessageV2.TextPart,
      ],
    }
  }

  /**
   * Creates StringDecoder-based helpers for shell stdout/stderr that correctly
   * handle multi-byte UTF-8 characters split across chunks.
   */
  export function createShellDecoders() {
    const stdout = new StringDecoder("utf8")
    const stderr = new StringDecoder("utf8")
    return {
      /** Decode a chunk from the given stream. */
      write(stream: "stdout" | "stderr", chunk: Buffer) {
        return stream === "stdout" ? stdout.write(chunk) : stderr.write(chunk)
      },
      /** Flush any trailing buffered bytes from both decoders. */
      flush() {
        return stdout.end() + stderr.end()
      },
    }
  }

  /**
   * Injects plan-specific reminders into the user message when using the plan agent.
   * Ensures the plan file directory exists and tells the agent where to write.
   */
  export async function insertPlanReminders(input: {
    agent: { name: string }
    session: Session.Info
    userMessage: MessageV2.WithParts
  }) {
    if (input.agent.name !== "plan") return
    const plan = Session.plan(input.session)
    const exists = await Filesystem.exists(plan)
    if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
    const info = exists
      ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
      : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`
    input.userMessage.parts.push({
      id: PartID.ascending(),
      messageID: input.userMessage.info.id,
      sessionID: input.userMessage.info.sessionID,
      type: "text",
      text: PROMPT_PLAN + `\n\n## Plan File\n${info}\nThis is the ONLY file you are allowed to write to or edit.`,
      synthetic: true,
    })
  }

  /**
   * Returns the CODE_SWITCH prompt text (plan-to-code transition).
   * Used when switching from plan agent to code agent.
   */
  export const CODE_SWITCH_TEXT = CODE_SWITCH

  /**
   * Determines the close reason for a session turn.
   * Checks for an explicit reason first (e.g. set on error during runLoop),
   * then falls back to inspecting the Effect exit value.
   */
  export function resolveCloseReason(input: {
    sessionID: string
    closeReasons: Map<string, KiloSession.CloseReason>
    exit: Exit.Exit<any, any>
  }): KiloSession.CloseReason {
    const explicit = input.closeReasons.get(input.sessionID)
    input.closeReasons.delete(input.sessionID)
    if (explicit) return explicit
    if (Exit.isFailure(input.exit)) {
      return Cause.hasInterruptsOnly(input.exit.cause) ? "interrupted" : "error"
    }
    return "completed"
  }

  /**
   * Maximum number of compactions attempted within a single turn before we
   * surface an exhaustion error. Three is enough to cover a normal overflow
   * compaction plus a summary-self-overflow retry without spinning forever.
   */
  export const MAX_COMPACTION_ATTEMPTS = 3

  /**
   * Guards a compaction attempt. When the attempt count has already reached
   * `MAX_COMPACTION_ATTEMPTS`, marks the close reason as `"error"`, attaches a
   * `ContextOverflowError` to the assistant message (if provided), and returns
   * `{ exhausted: true }` so callers can break out of the loop. Otherwise
   * returns `{ exhausted: false }`.
   */
  export function guardCompactionAttempt(input: {
    sessionID: string
    attempts: number
    closeReasons: Map<string, KiloSession.CloseReason>
    message?: MessageV2.Assistant
  }) {
    if (input.attempts < MAX_COMPACTION_ATTEMPTS) return { exhausted: false as const }
    const error = new MessageV2.ContextOverflowError({
      message: `Compaction exhausted: context still exceeds model limits after ${MAX_COMPACTION_ATTEMPTS} attempts`,
    }).toObject()
    input.closeReasons.set(input.sessionID, "error")
    if (input.message) {
      // Preserve any pre-existing error/finish the caller already set; only fill in blanks.
      input.message.error ??= error
      input.message.finish ??= "error"
    }
    return { exhausted: true as const, error }
  }
}
