import path from "path"
import { fileURLToPath } from "url"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Option } from "effect"
import type { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { NamedError } from "@opencode-ai/core/util/error"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Command } from "@/command"
import type { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { KiloSessionControl } from "@/kilocode/session/control"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { KiloSessionSteering } from "@/kilocode/session/steering"
import type { SessionPrompt } from "@/session/prompt"
import { MessageID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import type { SessionStatus } from "@/session/status"
import { NotFoundError } from "@/storage/storage"
import type { Event } from "./events"
import { KiloHooks } from "./hooks"
import { KiloHookLifecycle } from "./lifecycle"
import { KiloHookPayload } from "./payload"
import { KiloHookSession } from "./session"

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

type Model = { providerID: string; modelID: string; variant?: string }

// What `submit` learned about a prompt it admitted, for PreModelSwitch in `model`.
type Admission = {
  session: Session.Info
  sessions: Session.Interface
  status: SessionStatus.Interface
  root: SessionID
  agent?: string
  text: string
}

// Human prompts `submit` admitted: the PreModelSwitch gate.
const admissions = new WeakMap<SessionPrompt.PromptInput, Admission>()

// Per-session admission queue: each prompt's hooks wait for the previous prompt's (FIFO).
const tails = new Map<string, Promise<void>>()

function lock<A, E, R>(sessionID: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.suspend(() => {
      const previous = tails.get(sessionID) ?? Promise.resolve()
      const done = Promise.withResolvers<void>()
      // Settles once every earlier prompt and this one are through, even when one gave up waiting.
      const tail = previous.then(() => done.promise)
      tails.set(sessionID, tail)
      const release = Effect.sync(() => {
        done.resolve()
        void tail.then(() => {
          if (tails.get(sessionID) === tail) tails.delete(sessionID)
        })
      })
      return restore(Effect.promise(() => previous).pipe(Effect.andThen(work))).pipe(Effect.ensuring(release))
    }),
  )
}

/**
 * Shows an idle session busy while admission hooks run (clients show progress and a Stop button),
 * and idle again afterwards, passed or not, unless something else set its status meanwhile (a
 * turn that started). The prompt then recovers a failed or dangling turn and starts its own turn
 * as without hooks.
 */
function busy<A, E, R>(input: { sessionID: SessionID; status: SessionStatus.Interface }, work: Effect.Effect<A, E, R>) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      if ((yield* input.status.get(input.sessionID)).type !== "idle") return yield* restore(work)
      const mark: SessionStatus.Info = { type: "busy" }
      yield* input.status.set(input.sessionID, mark)
      const settle = Effect.gen(function* () {
        if ((yield* input.status.get(input.sessionID)) !== mark) return
        yield* input.status.set(input.sessionID, { type: "idle" })
      })
      return yield* restore(work).pipe(Effect.ensuring(settle))
    }),
  )
}

/**
 * Runs admission hooks for a prompt: inside the session's intake (a user Stop interrupts them and
 * kills their processes) and its FIFO admission queue, with the session shown busy meanwhile.
 */
function admit<A, E, R>(
  input: { sessionID: SessionID; status: SessionStatus.Interface },
  work: Effect.Effect<A, E, R>,
) {
  return KiloSessionPrompt.intake(input.sessionID, lock(input.sessionID, busy(input, work)))
}

/**
 * Shows why a prompt was rejected in the session (every time: each rejection needs its own
 * feedback), ending with the original prompt unless a hook asked to leave it out.
 */
const refuse = Effect.fnUntraced(function* (input: {
  events: EventV2.Interface
  sessionID: SessionID
  verdict: KiloHooks.Verdict
  message: string
  text: string
}) {
  const quiet = input.verdict.specific.some((item) => item.suppressOriginalPrompt === true)
  yield* input.events.publish(
    Session.Event.Error,
    {
      sessionID: input.sessionID,
      error: new NamedError.Unknown({
        message: quiet ? input.message : `${input.message}\n\nOriginal prompt: ${input.text}`,
      }).toObject(),
    },
    { metadata: { phase: "admission" } },
  )
  return new KiloHooks.Blocked(input.message)
})

function human(parts: Parts) {
  return parts
    .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
    .join("\n")
}

function context(name: Event, texts: readonly string[]): Parts {
  if (!texts.length) return []
  return [{ type: "text", synthetic: true, text: KiloHooks.wrap(name, texts), metadata: { hook: { event: name } } }]
}

function reason(verdict: KiloHooks.Verdict) {
  if (verdict.block) return verdict.block
  if (verdict.stop !== undefined) return verdict.stop.trim() || "No reason given."
  return undefined
}

function title(verdict: KiloHooks.Verdict) {
  return verdict.specific
    .map((item) => item.sessionTitle)
    .findLast((item): item is string => typeof item === "string" && !!item.trim())
    ?.trim()
}

function stamp<T extends { messageID?: MessageID }>(input: T) {
  return input.messageID ?? MessageID.ascending()
}

/** Reads sessions straight from the database, for call sites that have no session service. */
function rows(database: Database.Interface): Pick<Session.Interface, "get"> {
  return {
    get: (id) =>
      database.db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            row
              ? Effect.succeed(Session.fromRow(row))
              : Effect.fail(new NotFoundError({ message: `Session not found: ${id}` })),
          ),
        ),
  }
}

/** The session fields a tool-like hook payload needs: root, parent and permission mode. */
const lineage = Effect.fnUntraced(function* (sessionID: SessionID, database: Database.Interface, agent?: string) {
  const sessions = rows(database)
  const session = yield* sessions.get(sessionID).pipe(Effect.option)
  const info = Option.getOrUndefined(session)
  return {
    root: info?.parentID ? yield* KiloHookPayload.root(sessionID, sessions) : sessionID,
    parent: info?.parentID,
    mode: KiloHookPayload.mode(info?.permission, agent),
  }
})

/**
 * Runs UserPromptSubmit for a prompt or a slash command. Returns the context parts, or the reason
 * (already shown to the user) when a hook rejected it.
 */
const screen = Effect.fnUntraced(function* (input: {
  sessionID: SessionID
  session: Session.Info
  root: SessionID
  agent?: string
  key: string
  text: string
  hooks: KiloHooks.Hooks
  sessions: Session.Interface
  events: EventV2.Interface
}) {
  const session = input.session
  const verdict = yield* KiloHooks.fire({
    event: "UserPromptSubmit",
    hooks: input.hooks,
    payloads: [
      {
        ...KiloHookPayload.base("UserPromptSubmit", {
          sessionID: input.sessionID,
          root: input.root,
          parent: session.parentID,
          cwd: session.directory,
          agent: input.agent,
          prompt: input.key,
          mode: KiloHookPayload.mode(session.permission, input.agent),
        }),
        prompt: input.text,
        session_title: session.title,
      },
    ],
    cwd: session.directory,
    sessionID: input.sessionID,
    events: input.events,
  })
  const why = reason(verdict)
  if (why)
    return {
      blocked: yield* refuse({
        events: input.events,
        sessionID: input.sessionID,
        verdict,
        message: `UserPromptSubmit hook blocked this prompt: ${why}`,
        text: input.text,
      }),
      parts: [],
    }
  const name = title(verdict)
  if (name) yield* input.sessions.setTitle({ sessionID: input.sessionID, title: name })
  return { blocked: undefined, parts: context("UserPromptSubmit", verdict.context) }
})

/**
 * SessionStart (first prompt) and UserPromptSubmit for a human prompt. Returns the prompt with any
 * UserPromptSubmit context appended (SessionStart context goes on the next model step); a block
 * dies with `KiloHooks.Blocked` after notifying the user.
 */
export function submit(
  input: {
    input: SessionPrompt.PromptInput
    prior?: KiloSessionControl.Ticket
    sessions: Session.Interface
    status: SessionStatus.Interface
  } & Services,
): Effect.Effect<SessionPrompt.PromptInput> {
  return Effect.gen(function* () {
    const prompt = input.input
    // Command and Goal paths pass a ticket and handle their own prompt; hand-offs, background
    // results and synthetic prompts (wakeups, goal ticks, continuations) are not a human prompt.
    if (input.prior || prompt.noReply === true || KiloSessionControl.background(prompt.parts)) return prompt
    if (!prompt.parts.some((part) => part.type !== "text" || !part.synthetic)) return prompt
    const id = prompt.sessionID
    const session = yield* input.sessions.get(id).pipe(Effect.orDie)
    // Task-tool prompts to a subagent get SubagentStart; only a human steering it counts here.
    const steer = KiloSessionSteering.text(prompt.parts)
    if (session.parentID && !steer) return prompt
    const text = session.parentID ? steer : human(prompt.parts)
    const next = { ...prompt, messageID: stamp(prompt) }
    const root = session.parentID ? yield* KiloHookPayload.root(id, input.sessions) : id
    const agent = prompt.agent ?? session.agent
    const admission = { session, sessions: input.sessions, status: input.status, root, agent, text }
    admissions.set(next, admission)
    const start = !session.parentID && KiloHookSession.pending(id)
    const hooks = yield* KiloHookSession.find({
      sessionID: id,
      events: start ? ["UserPromptSubmit", "SessionStart", "SessionEnd", "InstructionsLoaded"] : ["UserPromptSubmit"],
      config: input.config,
      database: input.database,
    })
    const active = KiloHooks.select(hooks, "UserPromptSubmit", []).length > 0
    if (!active && !(start && hooks.SessionStart?.length)) {
      if (start) KiloHookSession.hold(id, yield* KiloHookSession.ensure({ ...input, sessionID: id, session, hooks }))
      return next
    }
    const parts = yield* admit(
      { sessionID: id, status: input.status },
      Effect.gen(function* () {
        if (start) KiloHookSession.hold(id, yield* KiloHookSession.ensure({ ...input, sessionID: id, session, hooks }))
        if (!active) return []
        const result = yield* screen({
          ...input,
          sessionID: id,
          session,
          root,
          agent,
          key: next.messageID,
          text,
          hooks,
        })
        if (result.blocked) return yield* Effect.die(result.blocked)
        return result.parts
      }),
    )
    if (!parts.length) return next
    const result = { ...next, parts: [...next.parts, ...parts] }
    admissions.set(result, admission)
    return result
  })
}

/** Whether `submit` admitted this prompt as a human prompt (the PreModelSwitch gate). */
export function admitted(input: SessionPrompt.PromptInput): boolean {
  return admissions.has(input)
}

function invocation(input: SessionPrompt.CommandInput) {
  return "/" + input.command + (input.arguments ? " " + input.arguments : "")
}

// Commands that import or hand off before any turn runs: their session starts on its first model
// step instead, with the source that history gives.
const DETACHED = new Set(["goal", "resume-claude", "resume-codex"])

/**
 * UserPromptSubmit for a slash command, before it expands. Returns context parts for the expanded
 * prompt; a block fails with `KiloHooks.Blocked`.
 */
export function command(
  input: {
    input: SessionPrompt.CommandInput
    sessions: Session.Interface
    status: SessionStatus.Interface
  } & Services,
): Effect.Effect<Parts, KiloHooks.Blocked> {
  return Effect.gen(function* () {
    const cmd = input.input
    // Stamped on arrival so the prompt keeps its place in the session whatever its hooks take.
    const key = stamp(cmd)
    ;(cmd as { messageID?: MessageID }).messageID = key
    const id = cmd.sessionID
    const session = yield* input.sessions.get(id).pipe(Effect.orDie)
    const start = !session.parentID && !DETACHED.has(cmd.command) && KiloHookSession.pending(id)
    const hooks = yield* KiloHookSession.find({
      sessionID: id,
      events: start ? ["UserPromptSubmit", "SessionStart", "SessionEnd", "InstructionsLoaded"] : ["UserPromptSubmit"],
      config: input.config,
      database: input.database,
    })
    const active = KiloHooks.select(hooks, "UserPromptSubmit", []).length > 0
    if (!active && !(start && hooks.SessionStart?.length)) {
      if (start) KiloHookSession.hold(id, yield* KiloHookSession.ensure({ ...input, sessionID: id, session, hooks }))
      return []
    }
    const agent = cmd.agent ?? session.agent
    const root = session.parentID ? yield* KiloHookPayload.root(id, input.sessions) : id
    return yield* admit(
      { sessionID: id, status: input.status },
      Effect.gen(function* () {
        if (start) KiloHookSession.hold(id, yield* KiloHookSession.ensure({ ...input, sessionID: id, session, hooks }))
        if (!active) return []
        const result = yield* screen({
          ...input,
          sessionID: id,
          session,
          root,
          agent,
          key,
          text: invocation(cmd),
          hooks,
        })
        if (result.blocked) return yield* Effect.fail(result.blocked)
        return result.parts
      }),
    )
  })
}

/**
 * UserPromptExpansion for a custom command, skill or MCP prompt, before its template runs.
 * Returns context parts; a block fails with `KiloHooks.Blocked`.
 */
export function expand(
  input: {
    input: SessionPrompt.CommandInput
    cmd: Command.Info
    sessions: Session.Interface
    status: SessionStatus.Interface
  } & Services,
): Effect.Effect<Parts, KiloHooks.Blocked> {
  return Effect.gen(function* () {
    const cmd = input.input
    const id = cmd.sessionID
    const hooks = yield* KiloHookSession.find({
      sessionID: id,
      events: ["UserPromptExpansion"],
      config: input.config,
      database: input.database,
    })
    if (!KiloHooks.select(hooks, "UserPromptExpansion", [cmd.command]).length) return []
    const session = yield* input.sessions.get(id).pipe(Effect.orDie)
    const text = invocation(cmd)
    const agent = cmd.agent ?? session.agent
    const root = session.parentID ? yield* KiloHookPayload.root(id, input.sessions) : id
    return yield* admit(
      { sessionID: id, status: input.status },
      Effect.gen(function* () {
        const verdict = yield* KiloHooks.fire({
          event: "UserPromptExpansion",
          hooks,
          subjects: [cmd.command],
          payloads: [
            {
              ...KiloHookPayload.base("UserPromptExpansion", {
                sessionID: id,
                root,
                parent: session.parentID,
                cwd: session.directory,
                agent,
                prompt: cmd.messageID,
                mode: KiloHookPayload.mode(session.permission, agent),
              }),
              expansion_type: input.cmd.source === "mcp" ? "mcp_prompt" : "slash_command",
              command_name: cmd.command,
              command_args: cmd.arguments,
              command_source: input.cmd.source ?? "command",
              prompt: text,
            },
          ],
          cwd: session.directory,
          sessionID: id,
          events: input.events,
        })
        const why = reason(verdict)
        if (why)
          return yield* Effect.fail(
            yield* refuse({
              events: input.events,
              sessionID: id,
              verdict,
              message: `UserPromptExpansion hook blocked ${text}: ${why}`,
              text,
            }),
          )
        return context("UserPromptExpansion", verdict.context)
      }),
    )
  })
}

function switching(from: Model, to: Model, source: "sdk" | "plan_followup") {
  const old = KiloHookPayload.model(from)
  const next = KiloHookPayload.model(to)
  return {
    subjects: next.subjects,
    fields: {
      from_model: old.bare,
      to_model: next.bare,
      requested_model: next.bare,
      source,
      kilo_from: { providerID: from.providerID, modelID: from.modelID, variant: from.variant },
      kilo_to: { providerID: to.providerID, modelID: to.modelID, variant: to.variant },
    },
  }
}

/** PostModelSwitch, detached; its context goes on the session's next model step. */
const post = Effect.fnUntraced(function* (input: {
  hooks: KiloHooks.Hooks
  session: Session.Info
  root: SessionID
  agent?: string
  from: Model
  to: Model
  source: "sdk" | "plan_followup"
  events: EventV2.Interface
}) {
  const change = switching(input.from, input.to, input.source)
  if (!KiloHooks.select(input.hooks, "PostModelSwitch", change.subjects).length) return
  const session = input.session
  const slot = KiloHookSession.pend(session.id)
  yield* KiloHookLifecycle.detach(
    KiloHooks.fire({
      event: "PostModelSwitch",
      hooks: input.hooks,
      subjects: change.subjects,
      payloads: [
        {
          ...KiloHookPayload.base("PostModelSwitch", {
            sessionID: session.id,
            root: input.root,
            parent: session.parentID,
            cwd: session.directory,
            agent: input.agent,
            mode: KiloHookPayload.mode(session.permission, input.agent),
          }),
          ...change.fields,
        },
      ],
      cwd: session.directory,
      sessionID: session.id,
      events: input.events,
    }).pipe(
      Effect.flatMap((verdict) => Deferred.succeed(slot, verdict.context)),
      // A run that never finished (instance disposed) must not hold up the next model step.
      Effect.ensuring(Deferred.succeed(slot, [])),
    ),
  )
})

/** Whether a prompt's model differs from the session's (provider or model; not a variant alone). */
function moved(from: Session.Info["model"] | undefined, to: Model): from is NonNullable<Session.Info["model"]> {
  return !!from && (from.providerID !== to.providerID || from.id !== to.modelID)
}

function ref(model: NonNullable<Session.Info["model"]>): Model {
  return { providerID: model.providerID, modelID: model.id, variant: model.variant }
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
  return Effect.gen(function* () {
    const admission = admissions.get(input.input)
    // Only a human prompt that changes the provider or model (not the first model of a session,
    // and not an agent or variant change alone) runs the switch hooks.
    if (!admission || !moved(input.from, input.to)) return yield* input.apply
    const id = input.sessionID
    const hooks = yield* KiloHookSession.find({
      sessionID: id,
      events: ["PreModelSwitch", "PostModelSwitch"],
      config: input.config,
      database: input.database,
    })
    const session = admission.session
    const subjects = KiloHookPayload.model(input.to).subjects
    const from = KiloHooks.select(hooks, "PreModelSwitch", subjects).length
      ? yield* lock(
          id,
          busy(
            { sessionID: id, status: admission.status },
            Effect.gen(function* () {
              // Read again in the admission queue: a prompt admitted before this one may have
              // switched the model meanwhile.
              const current = (yield* admission.sessions.get(id).pipe(Effect.orDie)).model
              if (!moved(current, input.to)) return current
              const change = switching(ref(current), input.to, "sdk")
              const verdict = yield* KiloHooks.fire({
                event: "PreModelSwitch",
                hooks,
                subjects: change.subjects,
                payloads: [
                  {
                    ...KiloHookPayload.base("PreModelSwitch", {
                      sessionID: id,
                      root: admission.root,
                      parent: session.parentID,
                      cwd: session.directory,
                      agent: input.agent,
                      prompt: stamp(input.input),
                      mode: KiloHookPayload.mode(session.permission, input.agent),
                    }),
                    ...change.fields,
                  },
                ],
                cwd: session.directory,
                sessionID: id,
                events: input.events,
              })
              const why = reason(verdict)
              if (!why) return current
              return yield* Effect.die(
                yield* refuse({
                  events: input.events,
                  sessionID: id,
                  verdict,
                  message: `PreModelSwitch hook blocked switching to ${change.fields.to_model}: ${why}`,
                  text: admission.text,
                }),
              )
            }),
          ),
        )
      : input.from
    yield* input.apply
    if (!moved(from, input.to)) return
    yield* post({
      hooks,
      session,
      root: admission.root,
      agent: input.agent,
      from: ref(from),
      to: input.to,
      source: "sdk",
      events: input.events,
    })
  })
}

/** PostModelSwitch for a switch Kilo made itself (the plan follow-up). */
export function switched(
  input: {
    sessionID: SessionID
    from?: Session.Info["model"]
    to: Session.Info["model"]
    source: "sdk" | "plan_followup"
    sessions: Session.Interface
  } & Services,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const to = input.to
    if (!to || !moved(input.from, ref(to))) return
    const from = input.from
    const id = input.sessionID
    const hooks = yield* KiloHookSession.find({
      sessionID: id,
      events: ["PostModelSwitch"],
      config: input.config,
      database: input.database,
    })
    if (!hooks.PostModelSwitch?.length) return
    const session = yield* input.sessions.get(id).pipe(Effect.orDie)
    const root = session.parentID ? yield* KiloHookPayload.root(id, input.sessions) : id
    yield* post({
      hooks,
      session,
      root,
      agent: session.agent,
      from: ref(from),
      to: ref(to),
      source: input.source,
      events: input.events,
    })
  })
}

/** The tool call a prompt attachment counts as for PreToolUse, if it is one. */
export function target(
  part: Extract<SessionPrompt.PromptInput["parts"][number], { type: "file" }>,
  directory: string,
):
  | {
      tool: string
      args: Record<string, unknown>
      source: "attachment" | "mcp_resource"
      server?: string
      name: string
    }
  | undefined {
  if (part.source?.type === "resource") {
    const source = part.source
    return {
      tool: "read_mcp_resource",
      args: { server: source.clientName, uri: source.uri },
      source: "mcp_resource",
      server: source.clientName,
      name: part.filename ?? source.uri,
    }
  }
  const url = URL.canParse(part.url) ? new URL(part.url) : undefined
  if (url?.protocol === "file:") {
    const file = fileURLToPath(part.url)
    const start = url.searchParams.get("start")
    const end = url.searchParams.get("end")
    const offset = start === null ? undefined : Math.max(parseInt(start) || 1, 1)
    const limit = offset !== undefined && end ? parseInt(end) - (offset - 1) : undefined
    return {
      tool: "read",
      args: {
        filePath: file,
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined || !Number.isFinite(limit) ? {} : { limit }),
      },
      source: "attachment",
      name: part.filename ?? file,
    }
  }
  if (url?.protocol === "data:" && part.mime === "text/plain") {
    // Without a file name, path guards see a placeholder, but the hooks still run.
    const file = part.filename ? path.resolve(directory, part.filename) : "<attachment>"
    return { tool: "read", args: { filePath: file }, source: "attachment", name: part.filename ?? "an attachment" }
  }
  return undefined
}

/** PreToolUse for a call that cannot show a prompt: an `ask` or a stop refuses it. */
const guard = Effect.fnUntraced(function* (input: {
  hooks: KiloHooks.Hooks
  call: KiloHooks.Call
  source: string
  events?: EventV2.Interface
}) {
  const call = input.call
  const verdict = yield* KiloHooks.fire({
    event: "PreToolUse",
    hooks: input.hooks,
    subjects: KiloHooks.names(call),
    call,
    payloads: KiloHooks.inputs("PreToolUse", call).map((item) => ({ ...item, kilo_source: input.source })),
    cwd: call.directory,
    sessionID: call.sessionID,
    events: input.events,
  })
  const why =
    reason(verdict) ??
    (verdict.ask === undefined
      ? undefined
      : `A hook asked for confirmation, but nobody can confirm this before the prompt is sent: ${verdict.ask}`)
  return { reason: why, context: verdict.context }
})

/**
 * PreToolUse (as Read / ReadMcpResourceTool) for a prompt attachment. Returns the parts that
 * replace a blocked attachment, or undefined to read it as usual.
 */
export function attachment(
  input: {
    part: Extract<SessionPrompt.PromptInput["parts"][number], { type: "file" }>
    sessionID: SessionID
    messageID: MessageID
    agent: string
    defer?: boolean
  } & Services,
): Effect.Effect<Draft<SessionV1.Part>[] | undefined> {
  return Effect.gen(function* () {
    const directory = (yield* InstanceState.context).directory
    const item = target(input.part, directory)
    if (!item) return undefined
    const hooks = yield* KiloHookSession.find({
      sessionID: input.sessionID,
      events: ["PreToolUse"],
      config: input.config,
      database: input.database,
    })
    const call: KiloHooks.Call = {
      tool: item.tool,
      args: item.args,
      sessionID: input.sessionID,
      directory,
      agent: input.agent,
      prompt: input.messageID,
      server: item.server,
    }
    if (!KiloHooks.select(hooks, "PreToolUse", KiloHooks.names(call), call).length) return undefined
    const session = yield* lineage(input.sessionID, input.database, input.agent)
    const verdict = yield* guard({
      hooks,
      call: { ...call, root: session.root, parent: session.parent, mode: session.mode },
      source: item.source,
      events: input.events,
    })
    if (!verdict.reason) {
      KiloHookSession.note(input.sessionID, "PreToolUse", verdict.context)
      return undefined
    }
    const text = `A PreToolUse hook blocked attaching ${item.name}: ${verdict.reason}`
    yield* KiloHooks.notice(input.events, input.sessionID, text)
    if (input.defer) return yield* Effect.die(new KiloHooks.Blocked(text))
    return [
      {
        messageID: input.messageID,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        text,
        metadata: { hook: { event: "PreToolUse" } },
      },
    ]
  })
}

/**
 * PreToolUse (as Bash) for each `!` shell line of a command template, inside the session's intake
 * so a user Stop kills a slow guard. Runs the allowed commands through `run` and returns the
 * outputs in order, with blocked ones replaced by the reason.
 */
export function template(input: {
  commands: string[]
  sessionID: SessionID
  agent?: string
  run: (commands: string[]) => Effect.Effect<string[]>
  config: Config.Interface
  database: Database.Interface
}): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const hooks = yield* KiloHookSession.find({
      sessionID: input.sessionID,
      events: ["PreToolUse"],
      config: input.config,
      database: input.database,
    })
    if (!KiloHooks.select(hooks, "PreToolUse", KiloHooks.names({ tool: "bash" })).length)
      return yield* input.run(input.commands)
    const directory = (yield* InstanceState.context).directory
    const session = yield* lineage(input.sessionID, input.database, input.agent)
    const verdicts = yield* KiloSessionPrompt.intake(
      input.sessionID,
      Effect.forEach(input.commands, (command) =>
        guard({
          hooks,
          source: "command_template",
          call: {
            tool: "bash",
            args: { command },
            sessionID: input.sessionID,
            directory,
            agent: input.agent,
            root: session.root,
            parent: session.parent,
            mode: session.mode,
          },
        }),
      ),
    )
    const allowed = input.commands.flatMap((command, index) => (verdicts[index]?.reason ? [] : [{ command, index }]))
    const outputs = allowed.length ? yield* input.run(allowed.map((item) => item.command)) : []
    const results = new Map(allowed.map((item, index) => [item.index, outputs[index] ?? ""]))
    return input.commands.map((_, index) => {
      const verdict = verdicts[index]
      if (verdict?.reason) return `A PreToolUse hook blocked this command: ${verdict.reason}`
      const output = results.get(index) ?? ""
      if (!verdict?.context.length) return output
      return `${output}\n\n<hook_feedback event="PreToolUse">\n${KiloHooks.clip(verdict.context.join("\n\n"))}\n</hook_feedback>`
    })
  })
}

export * as KiloHookPrompt from "./prompt"
