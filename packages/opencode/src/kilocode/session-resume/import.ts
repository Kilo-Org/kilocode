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

import fs from "node:fs"
import path from "node:path"
import { Effect, Option } from "effect"
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

    // Reject unknown sessions first. Without this the missing row surfaces as a
    // died `messages` call below (500, no usable message) instead of a
    // user-actionable failure the handler can map to 422.
    yield* sessions.get(sessionID).pipe(Effect.catch(() => fail(`Session not found: "${input.sessionID}".`)))

    // Reject nonempty sessions — importing into a session with history would
    // interleave the transcript with unrelated messages.
    const existing = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
    if (existing.length > 0) {
      return yield* fail("Start a new Kilo session, then run the import again.")
    }

    // Resolve agent. `agents.get` resolves to undefined for unknown names, so
    // reject those here instead of dying on `agent.name` further down.
    const agent = input.agent ? yield* agents.get(input.agent) : yield* agents.defaultInfo()
    if (!agent) {
      const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      return yield* fail(`Agent not found: "${input.agent}".${hint}`)
    }

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

  // ── Discovery ───────────────────────────────────────────────────────

  export type DiscoverInput = {
    /**
     * Directory whose external sessions to enumerate. Defaults to the current
     * instance directory (the project the caller is working in), matching how
     * the `/resume-claude` / `/resume-codex` slash commands scope discovery.
     */
    cwd?: string
    /** Formats to enumerate. Defaults to both `claude` and `codex`. */
    formats?: SessionResume.Format[]
  }

  /** A single discovered, importable external session. */
  export type Discovered = {
    /** Session UUID parsed from the transcript filename. */
    id: string
    /** Detected transcript format. */
    format: SessionResume.Format
    /** Absolute path to the JSONL transcript on the CLI host's filesystem. */
    path: string
    /** Last-modified time (epoch ms), most recent first. */
    mtime: number
    /** Source harness major version. */
    version: number
    /** First user message text (single line, clamped), if any. */
    title?: string
    /** Number of user + assistant steps in the transcript. */
    messages: number
    /** Source model reference (`providerID/modelID`), if the transcript records one. */
    model?: { providerID: string; modelID: string }
  }

  export type DiscoverResult = {
    /** Discovered sessions, most recently modified first. */
    sessions: Discovered[]
    /** Human-readable reasons for transcripts that were found but could not be previewed. */
    dropped: string[]
  }

  /** Whether an error is a "directory does not exist" filesystem error. */
  const isMissing = (err: unknown): boolean =>
    typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "ENOENT"

  /** Parse the session UUID out of a Claude/Codex JSONL filename. */
  const idFromFile = (format: SessionResume.Format, file: string): string | undefined => {
    const base = path.basename(file, ".jsonl")
    if (format === "claude") return SessionResume.isUUID(base) ? base : undefined
    // Codex filenames look like `rollout-<timestamp>-<uuid>.jsonl`.
    const tail = base.slice(-36)
    return SessionResume.isUUID(tail) ? tail : undefined
  }

  type DescribeResult = { entry?: Discovered; dropped?: string }

  /** Build a preview entry for one discovered transcript file. */
  const describe = (format: SessionResume.Format, file: string) =>
    Effect.gen(function* () {
      const id = idFromFile(format, file)
      if (!id) return { dropped: `Skipped ${path.basename(file)}: no session id in filename` } satisfies DescribeResult

      const p = yield* Effect.tryPromise({
        try: () => SessionResume.parse(file),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(Effect.map(SessionResume.preview))

      const mtime = yield* Effect.try({
        try: () => fs.statSync(file).mtimeMs,
        catch: () => new Error("stat failed"),
      }).pipe(Effect.orElseSucceed(() => 0))

      return {
        entry: {
          id,
          format,
          path: file,
          mtime,
          version: p.version,
          title: p.title,
          messages: p.messages,
          model: p.model,
        } satisfies Discovered,
      } satisfies DescribeResult
    }).pipe(
      Effect.catch((err) =>
        Effect.succeed({ dropped: `Skipped ${path.basename(file)}: ${err.message}` } satisfies DescribeResult),
      ),
    )

  /**
   * Enumerate importable Claude Code / Codex sessions for a directory.
   *
   * This is the read-only companion to `fromContent`: it scans the harness
   * transcript locations (via `SessionResume.discover*`) and previews each one
   * so callers can list importable sessions before choosing which content to
   * POST to the import endpoint. It never writes anything.
   */
  export const discover = Effect.fn("SessionResumeImport.discover")(function* (input?: DiscoverInput) {
    const ctx = yield* InstanceState.context
    const cwd = input?.cwd ?? ctx.directory
    const formats = input?.formats ?? (["claude", "codex"] as SessionResume.Format[])

    // Test-only seam so integration tests can redirect discovery roots without
    // touching the real home directory. Mirrors handleResume in prompt.ts.
    const roots = Option.getOrUndefined(yield* Effect.serviceOption(SessionResume.ResumeRoots)) ?? {}

    const files: { format: SessionResume.Format; file: string }[] = []
    const dropped: string[] = []

    // A missing harness directory (nothing ever recorded here) is not an error —
    // treat it as "no sessions". Any other read failure is surfaced as dropped.
    const enumerate = (format: SessionResume.Format, run: () => string[] | Promise<string[]>) =>
      Effect.tryPromise({
        try: () => Promise.resolve(run()),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(
        Effect.catch((err) => {
          if (isMissing(err)) return Effect.succeed<string[]>([])
          dropped.push(`${format} discovery failed: ${err.message}`)
          return Effect.succeed<string[]>([])
        }),
      )

    if (formats.includes("claude")) {
      const claude = yield* enumerate("claude", () => SessionResume.discoverClaude({ cwd, ...roots }))
      for (const file of claude) files.push({ format: "claude", file })
    }

    if (formats.includes("codex")) {
      const codex = yield* enumerate("codex", () => SessionResume.discoverCodex({ cwd, ...roots }))
      for (const file of codex) files.push({ format: "codex", file })
    }

    const sessions: Discovered[] = []
    for (const item of files) {
      const result: DescribeResult = yield* describe(item.format, item.file)
      if (result.entry) sessions.push(result.entry)
      if (result.dropped) dropped.push(result.dropped)
    }

    sessions.sort((a, b) => b.mtime - a.mtime)
    return { sessions, dropped } satisfies DiscoverResult
  })
}
