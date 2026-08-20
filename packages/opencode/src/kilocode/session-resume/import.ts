// kilocode_change - new file
//
// Shared "import a parsed transcript into a Kilo session" logic.
//
// SessionResume (./index.ts) is a pure parser/mapper with no Effect or Session
// dependencies. This module adds the Effect-based orchestration that both the
// `/resume-claude` / `/resume-codex` slash commands (src/session/prompt.ts) and
// the HTTP endpoint (src/kilocode/server/httpapi/.../session-resume) use to map a
// parsed transcript and write the resulting messages/parts through
// Session.Service. Keeping the write path here means every client (VS Code, CLI,
// TUI) can trigger a Claude Code / Codex import through the CLI server without
// reimplementing it.

import { Effect } from "effect"
import * as InstanceState from "@/effect/instance-state"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionResume } from "./index"

export namespace SessionResumeImport {
  export type WriteInput = {
    sessionID: string
    transcript: SessionResume.Transcript
    agent: string
    providerID: string
    modelID: string
    directory: string
    worktree: string
  }

  export type WriteResult = {
    /** Final assistant message written by the import. */
    last: SessionV1.WithParts
    /** Number of messages written to the session. */
    messages: number
    /** Human-readable reasons for any content that could not be imported. */
    dropped: string[]
  }

  const fail = (message: string) => Effect.fail(new NamedError.Unknown({ message }))

  /**
   * Map a parsed transcript and write it into an existing empty Kilo session.
   *
   * Shared by the slash-command handler and the HTTP endpoint. The caller is
   * responsible for resolving the agent + model and for rejecting nonempty
   * sessions before calling this. Fails with NamedError.Unknown for structural
   * problems (empty transcript, assistant-first) before writing anything.
   */
  export const write = Effect.fn("SessionResumeImport.write")(function* (input: WriteInput) {
    const sessions = yield* Session.Service
    const sessionID = SessionID.make(input.sessionID)

    const { messages: mapped, dropped } = SessionResume.mapTranscript(input.transcript, {
      sessionID: input.sessionID,
      agent: input.agent,
      providerID: input.providerID,
      modelID: input.modelID,
      directory: input.directory,
      worktree: input.worktree,
      sourceModel: input.transcript.sourceModel,
    })

    // The first message must be a user message (assistant messages need a user parent).
    if (mapped.length > 0 && mapped[0].info.role !== "user") {
      return yield* fail("Transcript starts with an assistant message. The first message must be from a user.")
    }

    // Write messages and parts in transcript order with ascending IDs, remapping
    // the placeholder IDs from mapTranscript to real ascending IDs.
    const idMap = new Map<string, string>()
    for (const item of mapped) {
      const newID = MessageID.ascending()
      idMap.set(item.info.id as string, newID)

      const parentID =
        item.info.role === "assistant" && typeof item.info.parentID === "string"
          ? idMap.get(item.info.parentID)
          : undefined

      const info = {
        ...item.info,
        id: newID,
        sessionID: input.sessionID,
        ...(parentID && { parentID }),
      } as SessionV1.Info

      yield* sessions.updateMessage(info)

      for (const part of item.parts) {
        const p = {
          ...part,
          id: PartID.ascending(),
          messageID: newID,
          sessionID: input.sessionID,
        } as SessionV1.Part
        yield* sessions.updatePart(p)
      }
    }

    yield* sessions.touch(sessionID)

    const resultMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
    const last = resultMsgs.findLast((m) => m.info.role === "assistant")
    if (!last) {
      return yield* fail("No assistant message found after import.")
    }

    return { last, messages: mapped.length, dropped } satisfies WriteResult
  })

  export type Input = {
    /** Target Kilo session. Must be empty (no existing messages). */
    sessionID: string
    /** Raw JSONL transcript content (Claude Code or Codex). */
    content: string
    /** Agent name to attribute the imported messages to. Defaults to the default agent. */
    agent?: string
    /** Model reference (`providerID/modelID`). Defaults to the agent/provider default. */
    model?: string
  }

  export type Result = {
    /** ID of the final assistant message written by the import. */
    messageID: string
    /** Detected transcript format. */
    format: SessionResume.Format
    /** Number of messages written to the session. */
    messages: number
    /** Human-readable reasons for any content that could not be imported. */
    dropped: string[]
  }

  /**
   * Import a raw JSONL transcript into an existing empty Kilo session.
   *
   * This is the entry point used by clients through the HTTP endpoint. It
   * resolves the agent + model, validates the transcript, and delegates the
   * write to `write`. Fails with NamedError.Unknown for any user-actionable
   * problem, and never writes to a session unless every validation has passed.
   */
  export const fromContent = Effect.fn("SessionResumeImport.fromContent")(function* (input: Input) {
    const ctx = yield* InstanceState.context
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service

    const sessionID = SessionID.make(input.sessionID)

    // Reject nonempty sessions — importing into a session with history would
    // interleave the transcript with unrelated messages.
    const existing = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
    if (existing.length > 0) {
      return yield* fail("Start a new Kilo session, then run the import again.")
    }

    // Resolve agent.
    const agent = input.agent ? yield* agents.get(input.agent) : yield* agents.defaultInfo()

    // Resolve model: explicit input → agent default → provider default.
    const model = input.model
      ? Provider.parseModel(input.model)
      : (agent.model ?? (yield* provider.defaultModel().pipe(Effect.orDie)))
    // Ensure the model is loadable so imported assistant messages reference a real model.
    yield* provider
      .getModel(model.providerID, model.modelID)
      .pipe(
        Effect.mapError(
          (err) => new NamedError.Unknown({ message: `Model not found: ${err.providerID}/${err.modelID}` }),
        ),
      )

    // Parse the transcript. SessionResume.parseLines throws ParseError on bad input.
    const transcript = yield* Effect.try({
      try: () => SessionResume.parseLines(input.content),
      catch: (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        return new NamedError.Unknown({ message: `Failed to parse session transcript: ${msg}` })
      },
    })

    // Reject transcripts without a real user message.
    const hasRealUser = transcript.steps.some(
      (s) => s.role === "user" && s.parts.some((p) => p.type === "text" && p.text.trim().length > 0),
    )
    if (!hasRealUser) {
      return yield* fail("The transcript contains no user messages. Nothing was imported.")
    }

    const result = yield* write({
      sessionID: input.sessionID,
      transcript,
      agent: agent.name,
      providerID: model.providerID,
      modelID: model.modelID,
      directory: ctx.directory,
      worktree: ctx.worktree,
    })

    return {
      messageID: result.last.info.id,
      format: transcript.format,
      messages: result.messages,
      dropped: result.dropped,
    } satisfies Result
  })
}
