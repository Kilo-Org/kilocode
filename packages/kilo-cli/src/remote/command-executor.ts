export * as RemoteCommands from "./command-executor"

import { Cause, Effect, Exit, Schema, Semaphore } from "effect"
import { sql } from "drizzle-orm"
import { createHash, randomUUID } from "node:crypto"
import { readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Instance } from "@opencode/core/instance/service"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Skill } from "@opencode/core/skill"
import { SessionEvent } from "@opencode/schema/session-event"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionMessage } from "@opencode/schema/session-message"

const Text = Schema.String.check(Schema.isNonEmpty())
const Live = { incarnation: Text, runID: Text }
const Selection = { agent: Schema.optional(Agent.ID), model: Schema.optional(Model.Ref) }
export const Payload = {
  create_session: Schema.Struct({
    directory: Schema.optional(Text),
    title: Schema.optional(Text),
    ...Selection,
    variant: Schema.optional(Model.VariantID),
    orgId: Schema.optional(Text),
  }),
  list_directories: Schema.Struct({ directory: Schema.optional(Text) }),
  send_message: Schema.Struct({
    text: Text,
    delivery: Schema.optional(Schema.Literals(["queue", "steer"])),
    ...Selection,
  }),
  interrupt: Schema.Struct(Live),
  drop_queued_message: Schema.Struct({ messageID: SessionMessage.ID }),
  permission_respond: Schema.Struct({
    ...Live,
    requestID: Permission.ID,
    reply: Permission.Reply,
    message: Schema.optional(Schema.String),
  }),
  question_reply: Schema.Struct({ ...Live, requestID: Form.ID, answers: Schema.Array(Schema.Array(Schema.String)) }),
  question_reject: Schema.Struct({ ...Live, requestID: Form.ID, message: Schema.optional(Schema.String) }),
  send_command: Schema.Struct({ command: Text, args: Schema.optional(Schema.String) }),
  "session.renamed": Schema.Struct({ title: Text }),
  empty: Schema.Struct({}),
}

export class Failure extends Schema.TaggedError<Failure>()("RemoteCommands.Failure", {
  code: Schema.String,
  message: Schema.String,
}) {}
export type Identity = { incarnation: string; runID?: string }
export type Outcome = {
  commandID: string
  status: "succeeded" | "failed" | "unknown"
  result?: unknown
  error?: { code: string; message: string }
  duplicate?: true
  identity?: Identity
}
export type Options = {
  launchDirectory: string
  userID: () => string | undefined
  organizationID: () => string | null | undefined
  canCreate?: () => boolean
  detach: (sessionID: string) => Effect.Effect<void>
}
type Owner = { userID: string; organizationID: string | null | undefined }

const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input ?? {}, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => new Failure({ code: "invalid_payload", message: "Invalid remote command payload" })),
  )
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const canonical = (value: Schema.Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const object = value as Schema.JsonObject
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key]!)}`)
    .join(",")}}`
}
const failure = (code: string, message: string) => Effect.fail(new Failure({ code, message }))
const contained = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
}
const directory = Effect.fn("RemoteCommands.directory")(function* (root: string, input = ".") {
  const target = path.resolve(root, input)
  if (!contained(root, target))
    return yield* failure("directory_escape", "Directory must be inside the launch directory")
  const resolved = yield* Effect.tryPromise({
    try: () => realpath(target),
    catch: () => new Failure({ code: "directory_unavailable", message: "Directory is unavailable" }),
  })
  if (!contained(root, resolved))
    return yield* failure("directory_escape", "Directory symlink leaves the launch directory")
  const info = yield* Effect.tryPromise({
    try: () => stat(resolved),
    catch: () => new Failure({ code: "directory_unavailable", message: "Directory is unavailable" }),
  })
  if (!info.isDirectory()) return yield* failure("not_directory", "Requested path is not a directory")
  return resolved
})

export const make = Effect.fn("RemoteCommands.make")(function* (options: Options) {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const sessions = yield* Session.Service
  const instances = yield* Instance.Service
  const locations = yield* LocationServiceMap.Service
  const lock = yield* Semaphore.make(1)
  const incarnation = randomUUID()
  const root = yield* Effect.tryPromise({
    try: () => realpath(options.launchDirectory),
    catch: () => new Failure({ code: "directory_unavailable", message: "Launch directory is unavailable" }),
  })
  yield* database.db
    .run(
      sql`CREATE TABLE IF NOT EXISTS _kilo_remote_command (
    scope TEXT NOT NULL, command_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    outcome TEXT, PRIMARY KEY(scope, command_id))`,
    )
    .pipe(Effect.orDie)
  yield* database.db
    .run(
      sql`CREATE TABLE IF NOT EXISTS _kilo_remote_run (
    session_id TEXT PRIMARY KEY, run_id TEXT NOT NULL)`,
    )
    .pipe(Effect.orDie)
  // Native event history is optional. Project the execution token in the same
  // transaction as its lifecycle instead of relying on the retained event log.
  yield* bus.project(SessionEvent.Execution.Started, (event) =>
    database.db
      .run(
        sql`INSERT INTO _kilo_remote_run(session_id,run_id)
      VALUES(${event.data.sessionID},${event.id})
      ON CONFLICT(session_id) DO UPDATE SET run_id=excluded.run_id`,
      )
      .pipe(Effect.orDie),
  )
  for (const definition of [
    SessionEvent.Execution.Succeeded,
    SessionEvent.Execution.Failed,
    SessionEvent.Execution.Interrupted,
  ])
    yield* bus.project(definition, (event) =>
      database.db.run(sql`DELETE FROM _kilo_remote_run WHERE session_id=${event.data.sessionID}`).pipe(Effect.orDie),
    )

  const identity = Effect.fn("RemoteCommands.identity")(function* (
    sessionID: string,
  ): Effect.fn.Return<Identity, Session.NotFoundError> {
    yield* sessions.get(Session.ID.make(sessionID))
    const run = yield* database.db
      .get<{ id: string }>(sql`SELECT run_id AS id FROM _kilo_remote_run WHERE session_id=${sessionID}`)
      .pipe(Effect.orDie)
    return { incarnation, ...(run ? { runID: run.id } : {}) }
  })
  const requireRun = Effect.fn("RemoteCommands.requireRun")(function* (
    sessionID: string,
    input: { incarnation: string; runID: string },
  ) {
    const current = yield* identity(sessionID)
    if (
      input.incarnation !== current.incarnation ||
      input.runID !== current.runID ||
      !(yield* sessions.active).has(Session.ID.make(sessionID))
    )
      return yield* failure("stale_run", "Command does not address the active runner and run")
  })
  const scoped = <A, E, R>(ref: Location.Ref, effect: Effect.Effect<A, E, R>) =>
    Effect.scoped(effect.pipe(Effect.provide(locations.get(ref))))
  const state = Effect.fn("RemoteCommands.state")(function* (sessionID: string) {
    const session = yield* sessions.get(Session.ID.make(sessionID))
    const pending = yield* Effect.gen(function* () {
      const permissions = yield* Permission.Service
      const forms = yield* Form.Service
      return {
        permissions: (yield* permissions.forSession(session.id)).map((request) => ({
          requestID: request.id,
          tool: request.action,
          summary: request.message ?? request.resources.join(", "),
        })),
        questions: (yield* forms.list({ sessionID }))
          .filter((form) => form.metadata?.kind === "question")
          .map((form) => ({
            requestID: form.id,
            fields: form.fields,
          })),
      }
    }).pipe(instances.provide(session))
    const current = yield* identity(sessionID)
    const running = current.runID !== undefined && (yield* sessions.active).has(session.id)
    return { incarnation: current.incarnation, runID: running ? current.runID! : null, running, pending }
  })
  const select = Effect.fn("RemoteCommands.select")(function* (input: { agent?: Agent.ID; model?: Model.Ref }) {
    if (input.agent) {
      const agents = yield* Agent.Service
      const agent = yield* agents.get(input.agent)
      if (!agent || agent.hidden || agent.mode === "subagent")
        return yield* failure("agent_unavailable", "Agent is not selectable")
    }
    if (input.model) {
      const models = yield* Model.Service
      const available = yield* models.available()
      const model = available.find(
        (model) => model.providerID === input.model!.providerID && model.id === input.model!.id,
      )
      if (!model || (input.model.variant && !model.variants.some((variant) => variant.id === input.model!.variant)))
        return yield* failure("model_unavailable", "Model or variant is not selectable")
    }
  })
  const discover = (type: string) =>
    Effect.gen(function* () {
      if (type === "list_models") {
        const models = yield* Model.Service
        return {
          models: (yield* models.available()).map((model) => ({
            id: model.id,
            providerID: model.providerID,
            name: model.name,
            limit: model.limit,
            variants: model.variants.map((variant) => ({ id: variant.id })),
          })),
        }
      }
      const agents = yield* Agent.Service
      return {
        agents: (yield* agents.list())
          .filter((agent) => !agent.hidden && agent.mode !== "subagent")
          .map(({ id, name, description, mode }) => ({ id, name, description, mode })),
      }
    })
  const create = Effect.fn("RemoteCommands.create")(function* (payload: unknown, commandID: string, owner: Owner) {
    const input = yield* decode(Payload.create_session, payload)
    if (input.orgId !== undefined && input.orgId !== owner.organizationID)
      return yield* failure("organization_mismatch", "Remote creation cannot change the signed-in organization")
    if (input.variant && !input.model) return yield* failure("invalid_payload", "Variant requires a model")
    const target = yield* directory(root, input.directory)
    const location = Location.Ref.make({ directory: AbsolutePath.make(target) })
    const model = input.model && { ...input.model, ...(input.variant ? { variant: input.variant } : {}) }
    yield* scoped(location, select({ agent: input.agent, model }))
    if (options.canCreate?.() === false) return yield* failure("remote_capacity", "Remote session capacity is full")
    const session = yield* sessions.create({
      id: Session.ID.make(
        `ses_${hash(JSON.stringify([root, owner.userID, owner.organizationID ?? null, commandID])).slice(0, 32)}`,
      ),
      location,
      title: input.title,
      agent: input.agent,
      model,
    })
    return { sessionID: session.id, directory: target }
  })
  const instance = Effect.fn("RemoteCommands.instance.execute")(function* (
    type: string,
    payload: unknown,
    commandID: string,
    owner: Owner,
  ) {
    if (type === "create_session") return yield* create(payload, commandID, owner)
    if (type === "list_directories") {
      const input = yield* decode(Payload.list_directories, payload)
      const target = yield* directory(root, input.directory)
      const entries = yield* Effect.tryPromise({
        try: () => readdir(target, { withFileTypes: true }),
        catch: () => new Failure({ code: "directory_unavailable", message: "Directory cannot be listed" }),
      })
      const directories = yield* Effect.forEach(
        entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()),
        (entry) =>
          directory(root, path.join(target, entry.name)).pipe(
            Effect.map((directory) => ({ name: entry.name, directory })),
            Effect.catchTag("RemoteCommands.Failure", () => Effect.succeed(undefined)),
          ),
      )
      return { directory: target, directories: directories.filter((entry) => entry !== undefined) }
    }
    if (type === "list_models" || type === "list_agents") {
      yield* decode(Payload.empty, payload)
      return yield* scoped(Location.Ref.make({ directory: AbsolutePath.make(root) }), discover(type))
    }
    return yield* failure("unsupported_command", `Unsupported instance command: ${type}`)
  })

  const execute = Effect.fn("RemoteCommands.session.execute")(function* (
    sessionID: string,
    type: string,
    payload: unknown,
    liveOnly: boolean,
    commandID: string,
  ) {
    const id = yield* decode(Session.ID, sessionID)
    const session = yield* sessions.get(id)
    yield* directory(root, session.location.directory)
    const messageID = SessionMessage.ID.make(`msg_${hash(`${sessionID}:${commandID}`).slice(0, 32)}`)
    if (
      type === "interrupt" ||
      type === "permission_respond" ||
      type === "question_reply" ||
      type === "question_reject"
    ) {
      const command =
        type === "interrupt"
          ? { type: "interrupt" as const, input: yield* decode(Payload.interrupt, payload) }
          : type === "permission_respond"
            ? { type: "permission_respond" as const, input: yield* decode(Payload.permission_respond, payload) }
            : type === "question_reply"
              ? { type: "question_reply" as const, input: yield* decode(Payload.question_reply, payload) }
              : { type: "question_reject" as const, input: yield* decode(Payload.question_reject, payload) }
      const input = command.input
      if (!liveOnly) return yield* failure("live_only_required", "This command must be live-only")
      yield* requireRun(sessionID, input)
      if (command.type === "interrupt") return { interrupted: yield* sessions.interrupt(id) }
      return yield* Effect.gen(function* () {
        if (command.type === "permission_respond") {
          const input = command.input
          const permissions = yield* Permission.Service
          const request = yield* permissions.get(input.requestID)
          if (!request || request.sessionID !== id)
            return yield* failure("stale_request", "Permission request is not pending for this session")
          yield* requireRun(sessionID, input)
          yield* permissions.reply({ requestID: input.requestID, reply: input.reply, message: input.message })
          return { requestID: input.requestID }
        }
        const forms = yield* Form.Service
        const input = command.input
        const form = yield* forms.get(input.requestID)
        if (
          form.sessionID !== id ||
          form.metadata?.kind !== "question" ||
          (yield* forms.state(input.requestID)).status !== "pending"
        )
          return yield* failure("stale_request", "Question is not pending for this session")
        if (command.type === "question_reply") {
          const input = command.input
          if (input.answers.length !== form.fields.length)
            return yield* failure("invalid_payload", "Answer count must match the pending question")
          if (input.answers.some((answer, index) => form.fields[index]!.type !== "multiselect" && answer.length > 1))
            return yield* failure("invalid_payload", "Single-choice questions accept at most one answer")
          yield* requireRun(sessionID, input)
          yield* forms.reply({
            id: input.requestID,
            answer: Object.fromEntries(
              input.answers.map((answer, index) => [
                form.fields[index]!.key,
                form.fields[index]!.type === "multiselect" ? answer : (answer[0] ?? ""),
              ]),
            ),
          })
        } else {
          yield* requireRun(sessionID, command.input)
          yield* forms.cancel(command.input.requestID, { message: command.input.message })
        }
        return { requestID: input.requestID }
      }).pipe(instances.provide(session))
    }
    if (type === "send_message") {
      const input = yield* decode(Payload.send_message, payload)
      yield* select(input).pipe(instances.provide(session))
      if (input.agent) yield* sessions.switchAgent({ sessionID: id, agent: input.agent })
      if (input.model) yield* sessions.switchModel({ sessionID: id, model: input.model })
      const admitted = yield* sessions.prompt({
        sessionID: id,
        id: messageID,
        text: input.text,
        delivery: input.delivery ?? "queue",
      })
      return { messageID: admitted.id }
    }
    if (type === "drop_queued_message") {
      const input = yield* decode(Payload.drop_queued_message, payload)
      yield* sessions.cancelInbox({ sessionID: id, inboxID: input.messageID })
      return { messageID: input.messageID }
    }
    if (type === "session.renamed") {
      const input = yield* decode(Payload["session.renamed"], payload)
      yield* sessions.rename({ sessionID: id, title: input.title })
      return { sessionID, title: input.title }
    }
    if (type === "detach") {
      yield* decode(Payload.empty, payload)
      yield* options.detach(sessionID)
      return { sessionID, detached: true }
    }
    if (type === "list_models" || type === "list_agents") {
      yield* decode(Payload.empty, payload)
      return yield* discover(type).pipe(instances.provide(session))
    }
    if (type === "list_commands") {
      yield* decode(Payload.empty, payload)
      const skills = yield* Skill.Service.pipe(
        Effect.flatMap((skills) => skills.list()),
        instances.provide(session),
      )
      return {
        commands: ["compact", "new", "skill", "models", "agents"],
        skills: skills.map(({ id, name, description }) => ({ id, name, description })),
        canDetach: true,
      }
    }
    if (type === "send_command") {
      const input = yield* decode(Payload.send_command, payload)
      const [command, ...rest] = input.command.trim().replace(/^\//, "").split(/\s+/)
      if (input.args !== undefined && rest.length) return yield* failure("invalid_payload", "Supply arguments once")
      const args = input.args ?? rest.join(" ")
      if (command === "compact" && !args) {
        yield* sessions.compact({ sessionID: id, id: messageID, delivery: "queue" })
        return { messageID }
      }
      if (command === "new" && !args) {
        if (options.canCreate?.() === false) return yield* failure("remote_capacity", "Remote session capacity is full")
        const created = yield* sessions.create({
          id: Session.ID.make(`ses_${hash(`${sessionID}:${commandID}`).slice(0, 32)}`),
          location: session.location,
          agent: session.agent,
          model: session.model,
        })
        return { sessionID: created.id, directory: created.location.directory }
      }
      if (command === "skill" && args) {
        yield* sessions.skill({ sessionID: id, messageID, skill: Skill.ID.make(args) })
        return { skill: args }
      }
      if (command === "models") {
        if (!args) return yield* discover("list_models").pipe(instances.provide(session))
        const model = yield* Effect.try({
          try: () => Model.Ref.parse(args),
          catch: () => new Failure({ code: "invalid_payload", message: "Use provider/model#variant" }),
        })
        yield* select({ model }).pipe(instances.provide(session))
        yield* sessions.switchModel({ sessionID: id, model })
        return { model }
      }
      if (command === "agents") {
        if (!args) return yield* discover("list_agents").pipe(instances.provide(session))
        const agent = Agent.ID.make(args)
        yield* select({ agent }).pipe(instances.provide(session))
        yield* sessions.switchAgent({ sessionID: id, agent })
        return { agent }
      }
      return yield* failure("unsafe_command", "Only /compact, /new, /skill, /models and /agents are permitted remotely")
    }
    return yield* failure("unsupported_command", `Unsupported session command: ${type}`)
  })

  const admitted = Effect.fn("RemoteCommands.admit")(function* (
    scope: string,
    commandID: string,
    type: string,
    payload: unknown,
    run: Effect.Effect<unknown, unknown>,
    sessionID?: string,
  ): Effect.fn.Return<Outcome> {
    if (!commandID || commandID.length > 256)
      return { commandID, status: "failed", error: { code: "invalid_command_id", message: "Invalid command ID" } }
    const fingerprint = hash(canonical({ type, payload: Schema.decodeUnknownSync(Schema.Json)(payload ?? null) }))
    const inserted = yield* database.db
      .get<{ command_id: string }>(
        sql`INSERT INTO _kilo_remote_command(scope,command_id,fingerprint)
      VALUES(${scope},${commandID},${fingerprint}) ON CONFLICT DO NOTHING RETURNING command_id`,
      )
      .pipe(Effect.orDie)
    if (!inserted) {
      const row = yield* database.db
        .get<{
          fingerprint: string
          outcome: string | null
        }>(sql`SELECT fingerprint,outcome FROM _kilo_remote_command WHERE scope=${scope} AND command_id=${commandID}`)
        .pipe(Effect.orDie)
      if (row?.fingerprint !== fingerprint)
        return {
          commandID,
          status: "failed",
          error: { code: "command_conflict", message: "Command ID already addresses a different command" },
        }
      return row.outcome
        ? { ...(JSON.parse(row.outcome) as Outcome), duplicate: true }
        : { commandID, status: "unknown", duplicate: true }
    }
    // A crash between admission and settlement stays unknown. Replaying it could repeat a side effect.
    const exit = yield* Effect.exit(run)
    if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return yield* Effect.interrupt
    const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
    const outcome: Outcome = Exit.isSuccess(exit)
      ? { commandID, status: "succeeded", result: exit.value }
      : {
          commandID,
          status: "failed",
          error:
            error instanceof Failure
              ? { code: error.code, message: error.message }
              : { code: "execution_failed", message: "Remote command failed" },
        }
    const current = sessionID ? yield* identity(sessionID).pipe(Effect.orElseSucceed(() => undefined)) : undefined
    if (current) outcome.identity = current
    yield* database.db
      .run(
        sql`UPDATE _kilo_remote_command SET outcome=${JSON.stringify(outcome)} WHERE scope=${scope} AND command_id=${commandID}`,
      )
      .pipe(Effect.orDie)
    return outcome
  })
  return {
    incarnation,
    identity,
    state,
    instance: (type: string, payload: unknown, commandID: string) =>
      lock.withPermit(
        Effect.suspend(() => {
          const userID = options.userID()
          if (!userID)
            return Effect.succeed<Outcome>({
              commandID,
              status: "failed",
              error: { code: "not_authenticated", message: "Remote commands require a signed-in account" },
            })
          const owner = { userID, organizationID: options.organizationID() }
          return admitted(
            `instance:${JSON.stringify([root, owner.userID, owner.organizationID ?? null])}`,
            commandID,
            type,
            payload,
            instance(type, payload, commandID, owner),
          )
        }),
      ),
    session: (sessionID: string, type: string, payload: unknown, liveOnly: boolean, commandID: string) =>
      lock.withPermit(
        admitted(
          `session:${sessionID}`,
          commandID,
          type,
          { payload: payload ?? null, liveOnly },
          execute(sessionID, type, payload, liveOnly, commandID),
          sessionID,
        ),
      ),
  }
})
