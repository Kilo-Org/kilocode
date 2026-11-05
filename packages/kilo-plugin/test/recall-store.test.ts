import { describe, expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionTable, SessionMessageTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Agent } from "@opencode/schema/agent"
import { Tool } from "@opencode/schema/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect } from "effect"
import { host } from "../../core/test/plugin/host"
import { testEffect } from "../../core/test/lib/effect"
import { withTempDir } from "../../core/test/fixture/tmpdir"
import { KiloRecallPlugin } from "../src/recall"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionStore.node])))

function seed(directory: string, worktree: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const project = Project.ID.make("project-a")
    yield* db
      .insert(ProjectTable)
      .values({ id: project, worktree: AbsolutePath.make(directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)

    const add = (id: string, title: string, dir: string) =>
      db
        .insert(SessionTable)
        .values({
          id: Session.ID.make(id),
          project_id: project,
          slug: id,
          directory: dir,
          title,
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

    yield* add("ses_root", "root session", directory)
    yield* add("ses_worktree", "worktree session", worktree)
    yield* add("ses_outside", "outside session", "/elsewhere")

    let seq = 0
    const message = (sessionID: string, id: string, type: SessionMessage.Type, data: object) =>
      db
        .insert(SessionMessageTable)
        .values({
          id: SessionMessage.ID.make(id),
          session_id: Session.ID.make(sessionID),
          type,
          seq: seq++,
          data: data as never,
          time_created: seq,
        })
        .run()
        .pipe(Effect.orDie)

    yield* message("ses_root", "msg_root", "user", { text: "root-needle", time: { created: 1 } })
    yield* message("ses_root", "msg_root_assistant", "assistant", {
      agent: "code",
      model: { id: "test", providerID: "test" },
      content: [{ type: "text", text: "assistant-needle" }],
      time: { created: 2, completed: 3 },
    })
    yield* message("ses_root", "msg_root_synthetic", "synthetic", {
      text: "synthetic-hidden-needle",
      time: { created: 4 },
    })
    yield* message("ses_worktree", "msg_worktree", "user", {
      text: "<system-reminder>worktree-needle</system-reminder>",
      time: { created: 2 },
    })
    yield* message("ses_outside", "msg_outside", "user", { text: "outside-needle", time: { created: 3 } })
    return { project, root: Session.ID.make("ses_root"), worktree: Session.ID.make("ses_worktree") }
  })
}

function capture() {
  const tools: Array<Tool.Info> = []
  const editor = {
    list: () => [],
    get: () => undefined,
    namespace: () => {},
    add: (tool: Tool.Info) => {
      tools.push(tool)
    },
    update: () => {},
    remove: () => {},
  }
  return { tools, editor }
}

const context = {
  sessionID: Session.ID.make("ses_reader"),
  agent: Agent.ID.make("code"),
  messageID: SessionMessage.ID.make("msg_reader"),
  id: Tool.CallID.make("call_recall"),
  progress: () => Effect.void,
}

function start(directory: string, worktree: string) {
  return Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const captured = capture()
    const ctx = host({
      location: new Location.Info({
        directory: AbsolutePath.make(directory),
        project: {
          id: Project.ID.make("project-a"),
          directory: AbsolutePath.make(directory),
          canonical: AbsolutePath.make(directory),
        },
      }),
      permission: {
        assert: () => Effect.void,
        hook: () => Effect.die("unused permission.hook"),
        list: () => Effect.die("unused permission.list"),
        get: () => Effect.die("unused permission.get"),
        reply: () => Effect.die("unused permission.reply"),
      },
      worktree: {
        list: () => Effect.succeed([{ directory: AbsolutePath.make(worktree) }]),
        create: () => Effect.die("unused worktree.create"),
        remove: () => Effect.die("unused worktree.remove"),
        refresh: () => Effect.die("unused worktree.refresh"),
        reload: () => Effect.die("unused worktree.reload"),
        transform: () => Effect.die("unused worktree.transform"),
      },
      tool: {
        transform: (callback) =>
          Effect.sync(() => {
            callback(captured.editor)
            return { dispose: Effect.void }
          }),
        reload: () => Effect.void,
        list: () => Effect.succeed([]),
        hook: () => Effect.die("unused tool.hook"),
      },
    })
    yield* Effect.scoped(
      KiloRecallPlugin.effect(ctx).pipe(Effect.provideService(SessionStore.Service, store)),
    )
    return captured.tools[0]!
  })
}

const run = (tool: Tool.Info, params: unknown) =>
  Effect.runPromise(
    tool.execute(params as never, context).pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, error }),
        onSuccess: (value) => ({ ok: true as const, value }),
      }),
    ),
  )

describe("recall plugin on the v2 session store", () => {
  it.live("searches the project worktree family and reads transcripts", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const directory = tmp.path
        const worktree = `${tmp.path}-worktree`
        yield* seed(directory, worktree)
        const tool = yield* start(directory, worktree)

        const root = yield* Effect.promise(() => run(tool, { mode: "search", query: "root-needle" }))
        expect(root.ok).toBe(true)
        if (root.ok) expect(root.value.output).toContain("root session")

        const assistant = yield* Effect.promise(() => run(tool, { mode: "search", query: "assistant-needle" }))
        expect(assistant.ok).toBe(true)
        if (assistant.ok) expect(assistant.value.output).toContain("assistant (msg_root_assistant:0)")

        const synthetic = yield* Effect.promise(() => run(tool, { mode: "search", query: "synthetic-hidden-needle" }))
        expect(synthetic.ok).toBe(true)
        if (synthetic.ok) expect(synthetic.value.output).toContain("no results")

        const sibling = yield* Effect.promise(() => run(tool, { mode: "search", query: "worktree-needle" }))
        expect(sibling.ok).toBe(true)
        if (sibling.ok) {
          expect(sibling.value.output).toContain("worktree session")
          expect(sibling.value.output).toContain("&lt;system-reminder&gt;worktree-needle")
        }

        const outside = yield* Effect.promise(() => run(tool, { mode: "search", query: "outside-needle" }))
        expect(outside.ok).toBe(true)
        if (outside.ok) expect(outside.value.output).toContain("no results")

        const read = yield* Effect.promise(() => run(tool, { mode: "read", sessionID: "ses_worktree" }))
        expect(read.ok).toBe(true)
        if (read.ok) {
          expect(read.value.output).toContain("# Session: worktree session")
          expect(read.value.output).toContain("&lt;system-reminder&gt;worktree-needle&lt;/system-reminder&gt;")
        }

        const rejected = yield* Effect.promise(() => run(tool, { mode: "read", sessionID: "ses_outside" }))
        expect(rejected.ok).toBe(false)
        if (!rejected.ok) expect(rejected.error.message).toContain("belongs to a different workspace")
      }),
    ),
  )
})
