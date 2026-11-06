import { expect } from "bun:test"
import { Context, DateTime, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Model } from "@opencode/core/model"
import { Skill } from "@opencode/core/skill"
import { Provider } from "@opencode/schema/provider"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Instance } from "@opencode/core/instance/service"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Event } from "@opencode/schema/event"
import { SessionEvent } from "@opencode/schema/session-event"
import { AbsolutePath } from "@opencode/schema/schema"
import { Location } from "@opencode/schema/location"
import { Project } from "@opencode/schema/project"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../../core/test/lib/effect"
import { RemoteCommands } from "../src/remote/command-executor"

const it = testEffect(Layer.empty).live
const id = Session.ID.make("ses_remote_test")

const fixture = Effect.fn("remote command fixture")(function* () {
  const temporary = yield* Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "remote-commands-")))
  yield* Effect.addFinalizer(() => Effect.promise(() => rm(temporary, { recursive: true, force: true })))
  const profile = yield* Effect.promise(() => realpath(temporary))
  const root = path.join(profile, "launch")
  yield* Effect.promise(() => mkdir(path.join(root, "workspace"), { recursive: true }))
  const context = yield* Layer.build(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
      Global.node.replace(
        Global.layerWith(
          Object.fromEntries(
            ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((name) => [
              name,
              path.join(profile, name),
            ]),
          ),
        ),
      ),
    ]),
  )
  const database = Context.get(context, Database.Service)
  const bus = Context.get(context, Bus.Service)
  const calls = {
    create: 0,
    prompt: 0,
    interrupt: 0,
    cancel: 0,
    rename: 0,
    detach: 0,
    permission: 0,
    reply: 0,
    reject: 0,
    compact: 0,
    model: 0,
    agent: 0,
    skill: 0,
  }
  const session = {
    id,
    projectID: Project.ID.global,
    location: Location.Ref.make({ directory: AbsolutePath.make(path.join(root, "workspace")) }),
    time: { created: DateTime.makeUnsafe(1), updated: DateTime.makeUnsafe(1), busy: DateTime.makeUnsafe(42) },
  } as Session.Info
  const control = {
    active: true,
    permissionSession: String(id),
    questionSession: String(id),
    questionPending: true,
    userID: "user-first",
    organizationID: "org-test" as string | null,
    canCreate: true,
    rolloverOnSessionGet: false,
    rolloverOnPermissionFetch: false,
    rolloverOnFormState: false,
    questionKeys: ["q0", "q1"],
    modelName: undefined as string | undefined,
  }
  let runSequence = 0
  const rotateRun = Effect.fn("remote fixture rotate run")(function* (terminal = false) {
    const options = { id: Event.ID.make(`evt_remote_run_${++runSequence}`) }
    if (terminal) yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id }, options)
    else yield* bus.publish(SessionEvent.Execution.Started, { sessionID: id }, options)
  })
  const permissions = {
    forSession: () =>
      Effect.succeed([
        {
          id: Permission.ID.make("per_remote"),
          sessionID: id,
          action: "shell",
          resources: ["printf fixture"],
          message: "Run fixture",
        },
      ]),
    get: () =>
      Effect.gen(function* () {
        if (control.rolloverOnPermissionFetch) {
          control.rolloverOnPermissionFetch = false
          yield* rotateRun()
        }
        return { id: Permission.ID.make("per_remote"), sessionID: control.permissionSession }
      }),
    reply: () =>
      Effect.sync(() => {
        calls.permission++
      }),
  } as unknown as Permission.Interface
  const forms = {
    list: () =>
      Effect.succeed(
        control.questionPending
          ? [
              {
                id: Form.ID.make("frm_remote"),
                sessionID: id,
                metadata: { kind: "question" },
                fields: [{ key: control.questionKeys[0]!, type: "string", title: "Decision" }],
              },
            ]
          : [],
      ),
    get: () =>
      Effect.succeed({
        id: Form.ID.make("frm_remote"),
        sessionID: control.questionSession,
        metadata: { kind: "question" },
        fields: [
          { key: control.questionKeys[0]!, type: "string" },
          { key: control.questionKeys[1]!, type: "multiselect" },
        ],
      }),
    state: () =>
      Effect.gen(function* () {
        if (control.rolloverOnFormState) {
          control.rolloverOnFormState = false
          yield* rotateRun()
        }
        return { status: control.questionPending ? "pending" : "answered" }
      }),
    reply: (input: Form.ReplyInput) =>
      Effect.sync(() => {
        expect(input.answer).toEqual({ [control.questionKeys[0]!]: "yes", [control.questionKeys[1]!]: ["one", "two"] })
        calls.reply++
      }),
    cancel: () =>
      Effect.sync(() => {
        calls.reject++
      }),
  } as unknown as Form.Interface
  const agent = Agent.Info.default(Agent.ID.make("build"))
  const model: Model.Info = {
    ...Model.Info.default(Provider.ID.make("kilo"), Model.ID.make("test")),
    variants: [{ id: Model.VariantID.make("fast") }],
    headers: { authorization: "do-not-disclose" },
  }
  const agents = { get: () => Effect.succeed(agent), list: () => Effect.succeed([agent]) } as unknown as Agent.Interface
  const models = {
    available: () => Effect.sync(() => [{ ...model, name: control.modelName ?? model.name }]),
  } as unknown as Model.Interface
  const skills = {
    list: () => Effect.succeed([{ id: Skill.ID.make("safe-skill"), name: "Safe skill", description: "A skill" }]),
  } as unknown as Skill.Interface
  const capabilities = Layer.mergeAll(
    Layer.succeed(Agent.Service, agents),
    Layer.succeed(Model.Service, models),
    Layer.succeed(Skill.Service, skills),
    Layer.succeed(Permission.Service, permissions),
    Layer.succeed(Form.Service, forms),
  )
  const sessions = {
    get: () =>
      Effect.gen(function* () {
        const snapshot = { ...session, time: { ...session.time } }
        if (control.rolloverOnSessionGet) {
          control.rolloverOnSessionGet = false
          yield* rotateRun()
        }
        return snapshot
      }),
    create: (input: Parameters<Session.Interface["create"]>[0]) =>
      Effect.sync(() => {
        calls.create++
        return { ...session, ...input }
      }),
    prompt: (input: Parameters<Session.Interface["prompt"]>[0]) =>
      Effect.sync(() => {
        expect(input.delivery).toBe("queue")
        calls.prompt++
        return { id: input.id }
      }),
    active: Effect.sync(() => new Set(control.active ? [id] : [])),
    interrupt: () =>
      Effect.sync(() => {
        calls.interrupt++
        return true
      }),
    cancelInbox: () =>
      Effect.sync(() => {
        calls.cancel++
      }),
    rename: () =>
      Effect.sync(() => {
        calls.rename++
      }),
    compact: () =>
      Effect.sync(() => {
        calls.compact++
      }),
    switchModel: () =>
      Effect.sync(() => {
        calls.model++
      }),
    switchAgent: () =>
      Effect.sync(() => {
        calls.agent++
      }),
    skill: () =>
      Effect.sync(() => {
        calls.skill++
      }),
  } as unknown as Session.Interface
  const instances: Instance.Interface = {
    provide:
      () =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provide(capabilities)) as Effect.Effect<A, E, Exclude<R, Instance.Services>>,
  }
  const locations = { get: () => capabilities } as unknown as Context.Service.Shape<typeof LocationServiceMap.Service>
  const boot = () =>
    RemoteCommands.make({
      launchDirectory: root,
      userID: () => control.userID,
      organizationID: () => control.organizationID,
      canCreate: () => control.canCreate,
      detach: () =>
        Effect.sync(() => {
          calls.detach++
        }),
    }).pipe(
      Effect.provideService(Database.Service, database),
      Effect.provideService(Bus.Service, bus),
      Effect.provideService(Session.Service, sessions),
      Effect.provideService(Instance.Service, instances),
      Effect.provideService(LocationServiceMap.Service, locations),
    )
  const commands = yield* boot()
  yield* rotateRun()
  return { root, database, session, calls, control, boot, rotateRun, commands }
})

it("create_session contains directories and never traverses an escaping symlink", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* Effect.promise(() => symlink(path.dirname(f.root), path.join(f.root, "escape")))
    const inside = yield* f.commands.instance(
      "create_session",
      { directory: "workspace", orgId: "org-test" },
      "create-1",
    )
    expect(inside.status).toBe("succeeded")
    expect(inside.result).toMatchObject({ directory: path.join(f.root, "workspace") })
    expect((yield* f.commands.instance("create_session", { directory: ".." }, "create-2")).error?.code).toBe(
      "directory_escape",
    )
    expect((yield* f.commands.instance("create_session", { directory: "escape" }, "create-3")).error?.code).toBe(
      "directory_escape",
    )
    expect((yield* f.commands.instance("create_session", { orgId: "other-org" }, "create-4")).error?.code).toBe(
      "organization_mismatch",
    )
    expect(f.calls.create).toBe(1)
  }))

it("list_directories omits escaping symlinks and rejects browsing through one", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* Effect.promise(() => symlink(path.dirname(f.root), path.join(f.root, "escape")))
    const listed = yield* f.commands.instance("list_directories", {}, "list-1")
    expect(listed.result).toEqual({
      directory: f.root,
      directories: [{ name: "workspace", directory: path.join(f.root, "workspace") }],
    })
    expect((yield* f.commands.instance("list_directories", { directory: "escape" }, "list-2")).error?.code).toBe(
      "directory_escape",
    )
  }))

it("durably deduplicates create_session and prompts across executor restarts", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.commands.instance("create_session", { directory: "workspace" }, "create")
    const restarted = yield* f.boot()
    expect((yield* restarted.instance("create_session", { directory: "workspace" }, "create")).duplicate).toBe(true)
    yield* f.commands.session(id, "send_message", { text: "queued prompt" }, false, "prompt")
    const duplicate = yield* restarted.session(id, "send_message", { text: "queued prompt" }, false, "prompt")
    expect(duplicate).toMatchObject({ status: "succeeded", duplicate: true })
    expect((yield* restarted.session(id, "send_message", { text: "changed" }, false, "prompt")).error?.code).toBe(
      "command_conflict",
    )
    expect(f.calls.create).toBe(1)
    expect(f.calls.prompt).toBe(1)
  }))

it("never reexecutes a durably admitted command with unknown settlement", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.commands.session(id, "send_message", { text: "once" }, false, "lost-settlement")
    yield* f.database.db.run(sql`UPDATE _kilo_remote_command SET outcome=NULL WHERE command_id='lost-settlement'`)
    const restarted = yield* f.boot()
    expect(yield* restarted.session(id, "send_message", { text: "once" }, false, "lost-settlement")).toMatchObject({
      status: "unknown",
      duplicate: true,
    })
    expect(f.calls.prompt).toBe(1)
  }))

it("evicted command results never allow a completed or unsettled effect to run again", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.commands.session(id, "send_message", { text: "settled" }, false, "old-settled")
    yield* f.commands.session(id, "send_message", { text: "pending" }, false, "old-pending")
    yield* f.database.db.run(sql`UPDATE _kilo_remote_command SET outcome=NULL WHERE command_id='old-pending'`)
    for (let index = 0; index < 260; index++)
      yield* f.commands.instance("list_directories", {}, `discovery-${index}`)
    expect(yield* f.database.db.get(sql`SELECT count(*) AS n FROM _kilo_remote_command WHERE outcome IS NOT NULL`))
      .toMatchObject({ n: 256 })
    for (const [commandID, text] of [["old-settled", "settled"], ["old-pending", "pending"]])
      expect(yield* f.commands.session(id, "send_message", { text }, false, commandID))
        .toMatchObject({ status: "unknown", duplicate: true })
    expect((yield* f.commands.session(id, "send_message", { text: "different" }, false, "old-settled")).error?.code)
      .toBe("command_conflict")
    expect(f.calls.prompt).toBe(2)
    const restarted = yield* f.boot()
    expect(yield* restarted.session(id, "send_message", { text: "settled" }, false, "old-settled"))
      .toMatchObject({ status: "unknown", duplicate: true })
    expect(f.calls.prompt).toBe(2)
  }))

it("upgrades legacy receipts and expires their payloads without deleting dedupe identities", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.commands.session(id, "send_message", { text: "legacy" }, false, "legacy")
    yield* f.database.db.run(sql`DROP INDEX _kilo_remote_command_results`)
    yield* f.database.db.run(sql`ALTER TABLE _kilo_remote_command DROP COLUMN created_at`)
    const restarted = yield* f.boot()
    expect(yield* restarted.session(id, "send_message", { text: "legacy" }, false, "legacy"))
      .toMatchObject({ status: "unknown", duplicate: true })
    expect(f.calls.prompt).toBe(1)
    yield* restarted.instance("list_directories", {}, "expired")
    yield* f.database.db.run(sql`UPDATE _kilo_remote_command SET created_at=${Date.now() - 86_400_001} WHERE command_id='expired'`)
    const again = yield* f.boot()
    expect(yield* again.instance("list_directories", {}, "expired"))
      .toMatchObject({ status: "unknown", duplicate: true })
  }))

it("returns a bounded actionable discovery failure and replays it without executing again", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* Effect.promise(() => Promise.all(
      Array.from({ length: 180 }, (_, index) => mkdir(path.join(f.root, `${index}-${"x".repeat(190)}`))),
    ))
    const result = yield* f.commands.instance("list_directories", {}, "large-discovery")
    expect(result).toMatchObject({ status: "failed", error: { code: "response_too_large" } })
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(60 * 1024)
    expect(yield* f.database.db.get<{ outcome: string }>(sql`SELECT outcome FROM _kilo_remote_command WHERE command_id='large-discovery'`))
      .toEqual({ outcome: JSON.stringify(result) })
    yield* Effect.promise(() => rm(f.root, { recursive: true }))
    expect(yield* f.commands.instance("list_directories", {}, "large-discovery"))
      .toMatchObject({ status: "failed", duplicate: true, error: { code: "response_too_large" } })
  }))

it("bounds legacy cached results before replaying them", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.commands.instance("list_directories", {}, "legacy-large")
    yield* f.database.db.run(sql`UPDATE _kilo_remote_command SET outcome=${JSON.stringify({
      commandID: "legacy-large",
      status: "succeeded",
      result: "x".repeat(65_536),
    })} WHERE command_id='legacy-large'`)
    yield* Effect.promise(() => rm(f.root, { recursive: true }))
    expect(yield* f.commands.instance("list_directories", {}, "legacy-large"))
      .toMatchObject({ status: "failed", duplicate: true, error: { code: "response_too_large" } })
  }))

it("reserves duplicate flag headroom at the result boundary", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    f.control.modelName = ""
    const probe = yield* f.commands.instance("list_models", {}, "probe-id")
    const replayBytes = Buffer.byteLength(',"duplicate":true')
    f.control.modelName = "x".repeat(60 * 1024 - replayBytes - Buffer.byteLength(JSON.stringify(probe)))
    const settled = yield* f.commands.instance("list_models", {}, "boundary")
    expect(settled.status).toBe("succeeded")
    const duplicate = yield* f.commands.instance("list_models", {}, "boundary")
    expect(duplicate).toEqual({ ...settled, duplicate: true })
    expect(Buffer.byteLength(JSON.stringify(duplicate))).toBe(60 * 1024)
    f.control.modelName += "x"
    expect(yield* f.commands.instance("list_models", {}, "overflow"))
      .toMatchObject({ status: "failed", error: { code: "response_too_large" } })
  }))

it("queued prompts work while live-only commands require current run and incarnation", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const live = yield* f.commands.identity(id)
    expect(live.runID).toBe("evt_remote_run_1")
    expect((yield* f.commands.session(id, "interrupt", live, false, "not-live")).error?.code).toBe("live_only_required")
    expect(
      (yield* f.commands.session(id, "interrupt", { ...live, incarnation: "old" }, true, "old-incarnation")).error
        ?.code,
    ).toBe("stale_run")
    expect((yield* f.commands.session(id, "interrupt", { ...live, runID: "41" }, true, "old-run")).error?.code).toBe(
      "stale_run",
    )
    expect((yield* f.commands.session(id, "interrupt", live, true, "current-run")).status).toBe("succeeded")
    f.control.active = false
    expect((yield* f.commands.session(id, "interrupt", live, true, "idle-run")).error?.code).toBe("stale_run")
    expect((yield* f.commands.session(id, "send_message", { text: "offline mailbox" }, false, "queued")).status).toBe(
      "succeeded",
    )
    expect(f.calls.interrupt).toBe(1)
    expect(f.calls.prompt).toBe(1)
  }))

it("permission and question responses bind requests to the active session", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const live = yield* f.commands.identity(id)
    f.control.permissionSession = "ses_other"
    expect(
      (yield* f.commands.session(
        id,
        "permission_respond",
        { ...live, requestID: "per_remote", reply: "once" },
        true,
        "wrong-permission",
      )).error?.code,
    ).toBe("stale_request")
    f.control.permissionSession = id
    expect(
      (yield* f.commands.session(
        id,
        "permission_respond",
        { ...live, requestID: "per_remote", reply: "once" },
        true,
        "permission",
      )).status,
    ).toBe("succeeded")
    f.control.questionSession = "ses_other"
    expect(
      (yield* f.commands.session(id, "question_reject", { ...live, requestID: "frm_remote" }, true, "wrong-question"))
        .error?.code,
    ).toBe("stale_request")
    f.control.questionSession = id
    expect(
      (yield* f.commands.session(
        id,
        "question_reply",
        { ...live, requestID: "frm_remote", answers: [["yes", "no"], []] },
        true,
        "extra-answer",
      )).error?.code,
    ).toBe("invalid_payload")
    expect(
      (yield* f.commands.session(
        id,
        "question_reply",
        { ...live, requestID: "frm_remote", answers: [["yes"], ["one", "two"]] },
        true,
        "question",
      )).status,
    ).toBe("succeeded")
    expect(
      (yield* f.commands.session(id, "question_reject", { ...live, requestID: "frm_remote" }, true, "reject")).status,
    ).toBe("succeeded")
    f.control.questionPending = false
    expect(
      (yield* f.commands.session(id, "question_reject", { ...live, requestID: "frm_remote" }, true, "settled")).error
        ?.code,
    ).toBe("stale_request")
    expect(f.calls.permission).toBe(1)
    expect(f.calls.reply).toBe(1)
    expect(f.calls.reject).toBe(1)
  }))

it("safe slash commands never dispatch arbitrary command templates or shell commands", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const command of ["/shell rm -rf /", "/deploy", "/exit", "/compact extra", "/new ../escape", "/connect"]) {
      expect((yield* f.commands.session(id, "send_command", { command }, false, command)).error?.code).toBe(
        "unsafe_command",
      )
    }
    expect((yield* f.commands.session(id, "send_command", { command: "/compact" }, false, "compact")).status).toBe(
      "succeeded",
    )
    expect((yield* f.commands.session(id, "send_command", { command: "/new" }, false, "new")).result).toMatchObject({
      directory: f.session.location.directory,
    })
    expect(f.calls.compact).toBe(1)
    expect(f.calls.create).toBe(1)
  }))

it("rejects malformed commands durably and dispatches rename, drop and detach natively", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const invalid = yield* f.commands.session(id, "send_message", { text: "hello", shell: "danger" }, false, "invalid")
    expect(invalid.error?.code).toBe("invalid_payload")
    expect(
      (yield* f.commands.session(id, "send_message", { text: "hello", shell: "danger" }, false, "invalid")).duplicate,
    ).toBe(true)
    expect(
      (yield* f.commands.session(id, "drop_queued_message", { messageID: "msg_queued" }, false, "drop")).status,
    ).toBe("succeeded")
    expect((yield* f.commands.session(id, "session.renamed", { title: "new title" }, false, "rename")).status).toBe(
      "succeeded",
    )
    expect((yield* f.commands.session(id, "detach", {}, false, "detach")).status).toBe("succeeded")
    expect(f.calls).toMatchObject({ prompt: 0, cancel: 1, rename: 1, detach: 1 })
  }))

it("discovers public models, agents and skills and maps safe selections to native services", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const models = yield* f.commands.instance("list_models", {}, "models")
    expect(models.result).toMatchObject({ models: [{ id: "test", providerID: "kilo", variants: [{ id: "fast" }] }] })
    expect(JSON.stringify(models)).not.toContain("do-not-disclose")
    const agents = yield* f.commands.instance("list_agents", {}, "agents")
    expect(agents.result).toEqual({ agents: [{ id: "build", name: "build", mode: "primary" }] })
    const catalog = yield* f.commands.session(id, "list_commands", {}, false, "catalog")
    expect(catalog.result).toMatchObject({
      commands: ["compact", "new", "skill", "models", "agents"],
      skills: [{ id: "safe-skill" }],
    })
    expect(
      (yield* f.commands.session(id, "send_command", { command: "/models kilo/test#fast" }, false, "select-model"))
        .status,
    ).toBe("succeeded")
    expect(
      (yield* f.commands.session(id, "send_command", { command: "/agents build" }, false, "select-agent")).status,
    ).toBe("succeeded")
    expect(
      (yield* f.commands.session(id, "send_command", { command: "/skill safe-skill" }, false, "skill")).status,
    ).toBe("succeeded")
    expect(
      (yield* f.commands.session(
        id,
        "send_command",
        { command: "/models kilo/test#missing" },
        false,
        "missing-variant",
      )).error?.code,
    ).toBe("model_unavailable")
    expect(f.calls).toMatchObject({ model: 1, agent: 1, skill: 1 })
  }))

it("SQLite admission fences concurrent executors using the same command ID", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const second = yield* f.boot()
    const outcomes = yield* Effect.all(
      [
        f.commands.session(id, "send_message", { text: "one submission" }, false, "concurrent"),
        second.session(id, "send_message", { text: "one submission" }, false, "concurrent"),
      ],
      { concurrency: "unbounded" },
    )
    expect(outcomes.filter((outcome) => outcome.duplicate)).toHaveLength(1)
    expect(f.calls.prompt).toBe(1)
  }))

it("instance receipts and created session IDs are isolated between signed-in users", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    f.control.organizationID = null
    const first = yield* f.commands.instance("create_session", { directory: "workspace" }, "shared-command")
    f.control.userID = "user-second"
    const second = yield* f.commands.instance("create_session", { directory: "workspace" }, "shared-command")
    expect(first.status).toBe("succeeded")
    expect(second.status).toBe("succeeded")
    expect(second.duplicate).toBeUndefined()
    expect(second.result).not.toEqual(first.result)
    f.control.userID = "user-first"
    const replay = yield* f.commands.instance("create_session", { directory: "workspace" }, "shared-command")
    expect(replay).toMatchObject({ duplicate: true, result: first.result })
    expect(f.calls.create).toBe(2)
  }))

it("run fences reject same-millisecond run replacements after command and request reads", () =>
  Effect.gen(function* () {
    for (const type of ["interrupt", "permission_respond", "question_reply", "question_reject"]) {
      const f = yield* fixture()
      const live = yield* f.commands.identity(id)
      if (type === "interrupt") f.control.rolloverOnSessionGet = true
      if (type === "permission_respond") f.control.rolloverOnPermissionFetch = true
      if (type === "question_reply" || type === "question_reject") f.control.rolloverOnFormState = true
      const payload =
        type === "interrupt"
          ? live
          : type === "permission_respond"
            ? { ...live, requestID: "per_remote", reply: "once" }
            : type === "question_reply"
              ? { ...live, requestID: "frm_remote", answers: [["yes"], ["one", "two"]] }
              : { ...live, requestID: "frm_remote" }
      const outcome = yield* f.commands.session(id, type, payload, true, `race-${type}`)
      expect(outcome.error?.code).toBe("stale_run")
      expect((yield* f.commands.identity(id)).runID).not.toBe(live.runID)
      expect(f.calls).toMatchObject({ interrupt: 0, permission: 0, reply: 0, reject: 0 })
    }
  }))

it("question replies preserve native form field keys", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    f.control.questionKeys = ["decision", "features"]
    const live = yield* f.commands.identity(id)
    const outcome = yield* f.commands.session(
      id,
      "question_reply",
      {
        ...live,
        requestID: "frm_remote",
        answers: [["yes"], ["one", "two"]],
      },
      true,
      "field-keys",
    )
    expect(outcome.status).toBe("succeeded")
    expect(f.calls.reply).toBe(1)
  }))

it("host capacity admission rejects both instance creation and safe /new before native creation", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    f.control.canCreate = false
    expect((yield* f.commands.instance("create_session", {}, "full-instance")).error?.code).toBe("remote_capacity")
    expect((yield* f.commands.session(id, "send_command", { command: "/new" }, false, "full-new")).error?.code).toBe(
      "remote_capacity",
    )
    expect(f.calls.create).toBe(0)
    // Capacity is transient: once a slot frees, retrying the same command IDs executes rather than replaying the rejection.
    f.control.canCreate = true
    const instance = yield* f.commands.instance("create_session", {}, "full-instance")
    expect(instance.status).toBe("succeeded")
    expect(instance.duplicate).toBeUndefined()
    expect((yield* f.commands.session(id, "send_command", { command: "/new" }, false, "full-new")).status).toBe(
      "succeeded",
    )
    expect(f.calls.create).toBe(2)
  }))

it("durable lifecycle order distinguishes a terminal and restart sharing one millisecond", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const first = yield* f.commands.identity(id)
    yield* f.rotateRun(true)
    expect((yield* f.commands.identity(id)).runID).toBeUndefined()
    yield* f.rotateRun()
    const next = yield* f.commands.identity(id)
    expect(next.runID).toBe("evt_remote_run_3")
    expect((yield* f.commands.session(id, "interrupt", first, true, "old-same-ms")).error?.code).toBe("stale_run")
    expect((yield* f.commands.session(id, "interrupt", next, true, "new-same-ms")).status).toBe("succeeded")
    expect(f.calls.interrupt).toBe(1)
  }))

it("remote state includes requests already pending and preserves their native keys", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    f.control.questionKeys = ["decision", "features"]
    const state = yield* f.commands.state(id)
    expect(state).toMatchObject({
      incarnation: f.commands.incarnation,
      runID: "evt_remote_run_1",
      running: true,
      pending: {
        permissions: [{ requestID: "per_remote", tool: "shell", summary: "Run fixture" }],
        questions: [{ requestID: "frm_remote", fields: [{ key: "decision", type: "string" }] }],
      },
    })
    f.control.questionPending = false
    yield* f.rotateRun(true)
    expect(yield* f.commands.state(id)).toMatchObject({ runID: null, running: false, pending: { questions: [] } })
  }))
