import { expect } from "bun:test"
import { Context, DateTime, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Skill } from "@opencode/core/skill"
import { Provider } from "@opencode/schema/provider"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Instance } from "@opencode/core/instance/service"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { Location } from "@opencode/schema/location"
import { Project } from "@opencode/schema/project"
import { Global } from "@opencode/util/global"
import { testEffect } from "../../core/test/lib/effect"
import { RemoteCommands } from "../src/remote/commands"

const it = testEffect(Layer.empty).live
const id = Session.ID.make("ses_remote_test")

const fixture = Effect.fn("remote command fixture")(function* () {
  const temporary = yield* Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "remote-commands-")))
  yield* Effect.addFinalizer(() => Effect.promise(() => rm(temporary, { recursive: true, force: true })))
  const profile = yield* Effect.promise(() => realpath(temporary))
  const root = path.join(profile, "launch")
  yield* Effect.promise(() => mkdir(path.join(root, "workspace"), { recursive: true }))
  const context = yield* Layer.build(
    AppNodeBuilder.build(Database.node, [
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
  }
  const permissions = {
    get: () => Effect.succeed({ id: Permission.ID.make("per_remote"), sessionID: control.permissionSession }),
    reply: () =>
      Effect.sync(() => {
        calls.permission++
      }),
  } as unknown as Permission.Interface
  const forms = {
    get: () =>
      Effect.succeed({
        id: Form.ID.make("frm_remote"),
        sessionID: control.questionSession,
        metadata: { kind: "question" },
        fields: [
          { key: "q0", type: "string" },
          { key: "q1", type: "multiselect" },
        ],
      }),
    state: () => Effect.succeed({ status: control.questionPending ? "pending" : "answered" }),
    reply: (input: Form.ReplyInput) =>
      Effect.sync(() => {
        expect(input.answer).toEqual({ q0: "yes", q1: ["one", "two"] })
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
  const models = { available: () => Effect.succeed([model]) } as unknown as Model.Interface
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
    get: () => Effect.succeed(session),
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
      detach: () =>
        Effect.sync(() => {
          calls.detach++
        }),
    }).pipe(
      Effect.provideService(Database.Service, database),
      Effect.provideService(Session.Service, sessions),
      Effect.provideService(Instance.Service, instances),
      Effect.provideService(LocationServiceMap.Service, locations),
    )
  return { root, database, session, calls, control, boot, commands: yield* boot() }
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

it("queued prompts work while live-only commands require current run and incarnation", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const live = yield* f.commands.identity(id)
    expect(live.runID).toBe("42")
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
