// kilocode_change - new file
import path from "path"
import fs from "fs/promises"
import { StringDecoder } from "string_decoder"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session"
import { Flag } from "@/flag/flag"
import { PlanFollowup } from "@/kilocode/plan-followup"
import { environmentDetails, type EditorContext } from "@/kilocode/editor-context"
import { Identifier } from "@/id/id"
import { Filesystem } from "@/util/filesystem"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Log } from "@/util/log"
import PROMPT_PLAN from "@/session/prompt/plan.txt"

const log = Log.create({ service: "kilocode.session.prompt" })

export namespace KiloSessionPrompt {
  // kilocode_change - tracks user message IDs whose leading @mention was
  // routed to a deterministic subtask. The loop calls consumeRoutedMention
  // after the subtask completes to decide whether to short-circuit before
  // normal orchestrator generation (so the orchestrator cannot answer the
  // routed request directly after the task tool runs).
  const routedMentions = new Set<string>()

  export function markRoutedMention(messageID: string) {
    routedMentions.add(messageID)
  }

  export function consumeRoutedMention(messageID: string): boolean {
    if (!routedMentions.has(messageID)) return false
    routedMentions.delete(messageID)
    return true
  }
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
   * End-of-loop handler: returns the most recent assistant message from the stream,
   * resolves any queued callbacks, and handles abort.
   */
  export async function resolveFinishedMessages(input: {
    sessionID: SessionID
    callbacks: { resolve(input: MessageV2.WithParts): void; reject(reason?: any): void }[]
    abort: AbortSignal
  }): Promise<MessageV2.WithParts> {
    for await (const item of MessageV2.stream(input.sessionID)) {
      if (item.info.role === "user") continue
      for (const q of input.callbacks) {
        q.resolve(item)
      }
      return item
    }
    if (input.abort.aborted) input.abort.throwIfAborted()
    throw new Error("Impossible")
  }

  /**
   * Deterministic routing for leading @<subagent> mentions.
   *
   * When a user message starts with @<name> (a registered agent), the normal
   * behavior would persist both the AgentPart and a synthetic "Use the above
   * message...call the task tool with subagent: <name>" hint. That hint relies
   * on the orchestrator LLM to obey, which it sometimes does not.
   *
   * This hook detects a leading AgentPart with source.start === 0 and rewrites
   * the user message parts to drop the prompt-only hint and instead persist a
   * SubtaskPart. The deterministic loop in session/prompt.ts then invokes the
   * task tool with the correct subagent_type BEFORE the orchestrator LLM sees
   * the message, guaranteeing routing.
   *
   * Returns true when routing was performed so callers can log/diagnose.
   */
  export async function routeLeadingAgentMention(input: {
    parts: MessageV2.Part[]
    sessionID: SessionID
    agent: Agent.Info
    messageID: MessageID
  }): Promise<boolean> {
    // Find an AgentPart whose source span claims the leading position
    // (source.start === 0). Clients submit parts in varying order — the
    // raw text part may come before or after the AgentPart — so we cannot
    // assume positional ordering. What matters is that the AgentPart's
    // source claims the start of the original input text.
    const lead: MessageV2.AgentPart | undefined = input.parts.find(
      (p): p is MessageV2.AgentPart => p.type === "agent" && p.source?.start === 0,
    )
    if (!lead) return false

    // Validate the target agent exists (substring @mentions without source
    // bounds are not routed).
    const target = await Agent.get(lead.name)
    if (!target) return false

    // Check task permission like the existing deterministic path does.
    const perm = Permission.evaluate("task", lead.name, input.agent.permission)
    if (perm.action === "deny") return false

    // Defense in depth: confirm there is a user-provided (non-synthetic) text
    // part whose leading characters are @<name>. Without this guard we'd
    // match the synthetic "Use the above message...call the task tool with
    // subagent: ..." hint that createUserMessage just appended for the
    // AgentPart, or trip on stray @ mentions that aren't routed.
    const userText = input.parts.find((p): p is MessageV2.TextPart => p.type === "text" && p.synthetic !== true)
    if (!userText) return false
    const mention = `@${lead.name}`
    if (!userText.text.trimStart().startsWith(mention)) return false

    // Drop the leading AgentPart (it served only as a routing signal).
    // Drop the synthetic "Use the above message..." hint text, if present,
    // because the deterministic subtask path replaces it.
    const hintText = " Use the above message and context to generate a prompt and call the task tool with subagent: "
    const filtered = input.parts.filter((p) => {
      if (p === lead) return false
      if (p.type === "text" && p.synthetic === true && typeof p.text === "string" && p.text.startsWith(hintText)) {
        return false
      }
      return true
    })

    // Strip the leading "@<name>" (and any immediately following whitespace)
    // from the user-provided text part so the subagent receives only the
    // remaining text.
    const userIdx = filtered.indexOf(userText)
    if (userIdx >= 0) {
      const idx = userText.text.indexOf(mention)
      filtered[userIdx] = {
        ...userText,
        text: userText.text.slice(0, idx) + userText.text.slice(idx + mention.length).replace(/^\s+/, ""),
      }
    }

    // Append the SubtaskPart so the deterministic loop picks it up.
    const remainingText = (() => {
      const t = filtered.find((p): p is MessageV2.TextPart => p.type === "text")
      return t ? t.text : ""
    })()
    filtered.push({
      id: PartID.ascending(),
      messageID: input.messageID,
      sessionID: input.sessionID,
      type: "subtask",
      prompt: remainingText,
      description: mention,
      agent: target.name,
    } satisfies MessageV2.SubtaskPart)

    // Mutate the input array in place so Session.updateMessage + per-part
    // saves downstream persist the deterministic routing parts.
    input.parts.length = 0
    input.parts.push(...filtered)

    // Mark the user message so the deterministic loop short-circuits after
    // the task tool runs (instead of letting the orchestrator answer the
    // routed request directly).
    markRoutedMention(input.messageID)

    log.info("routed leading @mention to deterministic subtask", {
      agent: target.name,
      sessionID: input.sessionID,
    })
    return true
  }
}

function iife<T>(fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(fn())
}
