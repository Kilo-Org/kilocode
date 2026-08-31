// kilocode_change - new file
//
// Shared "import a parsed transcript into a Kilo session" logic.
//
// SessionResume (./index.ts) is a pure parser/mapper with no Effect or Session
// dependencies. This module adds the Effect-based orchestration that both the
// `/resume-claude` / `/resume-codex` slash commands (src/session/prompt.ts) and
// the migrate HTTP endpoints (src/kilocode/server/httpapi/.../migrate) use to map
// a parsed transcript and write the resulting messages/parts through
// Session.Service. Keeping the write path here means every client (VS Code, CLI,
// TUI) can trigger a Claude Code / Codex import through the CLI server without
// reimplementing it.

import fs from "node:fs"
import path from "node:path"
import { and, eq, isNotNull } from "drizzle-orm"
import { Cause, Effect, Exit, Option } from "effect"
import * as InstanceState from "@/effect/instance-state"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
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

  const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

  /**
   * Resolve the agent + model imported messages are attributed to.
   *
   * Explicit input wins, then the agent default, then the provider default. The
   * model is loaded so imported assistant messages always reference a real one.
   */
  const resolve = Effect.fn("SessionResumeImport.resolve")(function* (input: { agent?: string; model?: string }) {
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service

    // `agents.get` resolves to undefined for unknown names, so reject those here
    // instead of dying on `agent.name` further down.
    const agent = input.agent ? yield* agents.get(input.agent) : yield* agents.defaultInfo()
    if (!agent) {
      const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      return yield* fail(`Agent not found: "${input.agent}".${hint}`)
    }

    const model = input.model
      ? Provider.parseModel(input.model)
      : (agent.model ?? (yield* provider.defaultModel().pipe(Effect.orDie)))
    yield* provider
      .getModel(model.providerID, model.modelID)
      .pipe(
        Effect.mapError(
          (err) => new NamedError.Unknown({ message: `Model not found: ${err.providerID}/${err.modelID}` }),
        ),
      )

    return { agent: agent.name, providerID: model.providerID, modelID: model.modelID }
  })

  /** Reject transcripts with nothing worth importing. */
  const requireUser = (transcript: SessionResume.Transcript) =>
    transcript.steps.some(
      (s) => s.role === "user" && s.parts.some((p) => p.type === "text" && p.text.trim().length > 0),
    )
      ? Effect.void
      : fail("The transcript contains no user messages. Nothing was imported.")

  /**
   * Import a raw JSONL transcript into an existing empty Kilo session.
   *
   * Building block for `migrate`, and the entry point for callers that already
   * hold the transcript bytes. Fails with NamedError.Unknown for any
   * user-actionable problem, and never writes unless every validation passed.
   */
  export const fromContent = Effect.fn("SessionResumeImport.fromContent")(function* (input: Input) {
    const ctx = yield* InstanceState.context
    const sessions = yield* Session.Service

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

    const target = yield* resolve(input)

    // Parse the transcript. SessionResume.parseLines throws ParseError on bad input.
    const transcript = yield* Effect.try({
      try: () => SessionResume.parseLines(input.content),
      catch: (err) => new NamedError.Unknown({ message: `Failed to parse session transcript: ${reason(err)}` }),
    })
    yield* requireUser(transcript)

    const result = yield* write({
      sessionID: input.sessionID,
      transcript,
      ...target,
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

  // ── Migration bookkeeping ───────────────────────────────────────────
  //
  // Migrating the same transcript twice would silently duplicate a session:
  // `write` mints fresh ascending IDs every time, so nothing about the target
  // session identifies where its content came from. Record the source identity
  // on the session we create and read it back before migrating, so `migrate`
  // becomes a no-op once a source has landed. This mirrors how the v5 session
  // import decides to skip (`SessionImportService.session` returns
  // `skipped: true` for a source it has already stored, with `force` to
  // override) — but keyed off an explicit marker rather than a hashed row ID,
  // since Kilo session IDs must stay time-sortable.

  /** Key under `session.metadata` holding the migration marker. */
  const KEY = "migrate"

  /** Provenance recorded on a Kilo session created by a migration. */
  export type Marker = {
    /** Source harness the transcript came from. */
    format: SessionResume.Format
    /** Source session UUID. */
    id: string
    /** Transcript path at migration time. */
    path: string
    /** When the migration ran (epoch ms). */
    time: number
  }

  /** Identity of an external transcript, unique per harness + source session. */
  const identity = (format: string, id: string) => `${format}:${id}`

  /** Read a migration marker off a session's metadata, if it carries one. */
  const marker = (metadata: Record<string, unknown> | undefined) => {
    const value = metadata?.[KEY]
    if (typeof value !== "object" || value === null) return
    const format = "format" in value ? value.format : undefined
    const id = "id" in value ? value.id : undefined
    if (typeof format !== "string" || typeof id !== "string") return
    return { format, id }
  }

  /**
   * Map of already-migrated source identity to the Kilo session holding it.
   *
   * Queried straight off the table rather than through `Session.list`, which
   * pages to the 100 most recently updated sessions — older markers would fall
   * out of that window and the same source would be migrated again. Narrowing to
   * rows that carry any metadata keeps this far smaller than the full project.
   */
  const migrated = Effect.fn("SessionResumeImport.migrated")(function* () {
    const ctx = yield* InstanceState.context
    const { db } = yield* Database.Service
    const rows = yield* db
      .select({ id: SessionTable.id, metadata: SessionTable.metadata })
      .from(SessionTable)
      .where(and(eq(SessionTable.project_id, ctx.project.id), isNotNull(SessionTable.metadata)))
      .all()
      .pipe(Effect.orDie)

    const found = new Map<string, string>()
    for (const row of rows) {
      const mark = marker(row.metadata ?? undefined)
      if (mark) found.set(identity(mark.format, mark.id), row.id)
    }
    return found
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
    /**
     * Kilo session this transcript was already migrated into. Present means a
     * migration would skip it, so clients can mark it as done in a picker.
     */
    sessionID?: string
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
   * Enumerate migratable Claude Code / Codex sessions for a directory.
   *
   * This is the read-only companion to `migrate`: it scans the harness
   * transcript locations (via `SessionResume.discover*`), previews each one, and
   * marks the ones already migrated so callers can render a picker. It never
   * writes anything.
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

    const done = yield* migrated()
    const sessions: Discovered[] = []
    for (const item of files) {
      const result: DescribeResult = yield* describe(item.format, item.file)
      if (result.entry) {
        const sessionID = done.get(identity(result.entry.format, result.entry.id))
        sessions.push(sessionID ? { ...result.entry, sessionID } : result.entry)
      }
      if (result.dropped) dropped.push(result.dropped)
    }

    sessions.sort((a, b) => b.mtime - a.mtime)
    return { sessions, dropped } satisfies DiscoverResult
  })

  // ── Migration ───────────────────────────────────────────────────────

  export type MigrateInput = {
    /** Directory whose external sessions to migrate. Defaults to the instance directory. */
    cwd?: string
    /** Formats to consider. Defaults to both `claude` and `codex`. */
    formats?: SessionResume.Format[]
    /**
     * Only migrate these discovered source session IDs. Omit to migrate every
     * discovered session. Unknown IDs fail the request.
     */
    ids?: string[]
    /** Agent to attribute migrated messages to. Defaults to the default agent. */
    agent?: string
    /** Model reference (`providerID/modelID`). Defaults to the agent/provider default. */
    model?: string
    /** Migrate sources again even if they already landed, creating new sessions. */
    force?: boolean
  }

  /** Outcome for one discovered source session. */
  export type Migrated = {
    /** Source session UUID. */
    id: string
    /** Source transcript format. */
    format: SessionResume.Format
    /** Kilo session holding the transcript. Absent only when the migration failed. */
    sessionID?: string
    /** Final assistant message written, when this call performed the migration. */
    messageID?: string
    /** Number of messages written, when this call performed the migration. */
    messages?: number
    /** True when the source had already been migrated and this call did nothing. */
    skipped: boolean
    /** Why this source could not be migrated. */
    error?: string
    /** Human-readable reasons for content that could not be migrated. */
    dropped: string[]
  }

  export type MigrateResult = {
    /** Per-source outcomes, most recently modified source first. */
    sessions: Migrated[]
    /** Number of sources migrated by this call. */
    migrated: number
    /** Number of sources skipped because they had already been migrated. */
    skipped: number
    /** Reasons transcripts were found but could not be previewed or migrated. */
    dropped: string[]
  }

  /** Read, parse and write one discovered transcript into a session of its own. */
  const apply = Effect.fn("SessionResumeImport.apply")(function* (input: {
    item: Discovered
    agent: string
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    directory: string
    worktree: string
  }) {
    const sessions = yield* Session.Service

    // Read and validate before creating anything, so an unreadable or empty
    // transcript never leaves a stray session behind.
    const transcript = yield* Effect.tryPromise({
      try: () => SessionResume.parse(input.item.path),
      catch: (err) => new NamedError.Unknown({ message: `Failed to parse session transcript: ${reason(err)}` }),
    })
    yield* requireUser(transcript)

    const session = yield* sessions.create({
      title: input.item.title ?? `${input.item.format} session ${input.item.id.slice(0, 8)}`,
      agent: input.agent,
      model: { providerID: input.providerID, id: input.modelID },
      metadata: {
        [KEY]: {
          format: input.item.format,
          id: input.item.id,
          path: input.item.path,
          time: Date.now(),
        } satisfies Marker,
      },
    })

    // The session exists now, so a write failure has to clean up after itself or
    // the next migration sees a marked-but-empty session and skips the source.
    const outcome = yield* Effect.exit(
      write({
        sessionID: session.id,
        transcript,
        agent: input.agent,
        providerID: input.providerID,
        modelID: input.modelID,
        directory: input.directory,
        worktree: input.worktree,
      }),
    )
    if (Exit.isFailure(outcome)) {
      yield* sessions.remove(session.id).pipe(Effect.orDie)
      return yield* Effect.failCause(outcome.cause)
    }

    return {
      sessionID: session.id,
      messageID: outcome.value.last.info.id,
      messages: outcome.value.messages,
      dropped: outcome.value.dropped,
    }
  })

  /**
   * Discover and migrate external sessions into Kilo, skipping ones already done.
   *
   * Re-discovers server-side on every call so clients never move transcript
   * bytes, and is a no-op once every discovered source has been migrated, which
   * makes it safe to call on startup or behind a "check again" button. Only
   * request-level problems (unknown agent, unloadable model, unknown requested
   * ID) fail the call; a single unreadable transcript is reported against its
   * own entry so it cannot block the rest.
   */
  export const migrate = Effect.fn("SessionResumeImport.migrate")(function* (input?: MigrateInput) {
    const ctx = yield* InstanceState.context

    // Resolve once up front: a bad agent or model applies to every source, so it
    // should fail the request rather than every individual entry.
    const target = yield* resolve({ agent: input?.agent, model: input?.model })

    const found = yield* discover({ cwd: input?.cwd, formats: input?.formats })
    const ids = input?.ids
    const wanted = ids ? found.sessions.filter((item) => ids.includes(item.id)) : found.sessions

    if (ids) {
      const missing = ids.filter((id) => !found.sessions.some((item) => item.id === id))
      if (missing.length > 0) {
        return yield* fail(`No Claude Code or OpenAI Codex session found with ID: ${missing.join(", ")}`)
      }
    }

    const results: Migrated[] = []
    const dropped = [...found.dropped]

    for (const item of wanted) {
      // `discover` already resolved this against existing sessions.
      if (item.sessionID && !input?.force) {
        results.push({ id: item.id, format: item.format, sessionID: item.sessionID, skipped: true, dropped: [] })
        continue
      }

      const outcome = yield* Effect.exit(apply({ item, ...target, directory: ctx.directory, worktree: ctx.worktree }))
      if (Exit.isFailure(outcome)) {
        const err = Cause.squash(outcome.cause)
        const message = NamedError.Unknown.isInstance(err) ? err.data.message : reason(err)
        results.push({ id: item.id, format: item.format, skipped: false, error: message, dropped: [] })
        dropped.push(`Skipped ${path.basename(item.path)}: ${message}`)
        continue
      }

      results.push({
        id: item.id,
        format: item.format,
        sessionID: outcome.value.sessionID,
        messageID: outcome.value.messageID,
        messages: outcome.value.messages,
        skipped: false,
        dropped: outcome.value.dropped,
      })
    }

    return {
      sessions: results,
      migrated: results.filter((item) => !item.skipped && !item.error).length,
      skipped: results.filter((item) => item.skipped).length,
      dropped,
    } satisfies MigrateResult
  })
}
