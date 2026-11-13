import { expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { KiloBoardRpc } from "@opencode/schema/kilocode/board"
import { SessionMessage } from "@opencode/schema/session-message"
import { DateTime, Effect, Stream } from "effect"
import { tempLocationLayer } from "../../core/test/fixture/location"
import { testEffect } from "../../core/test/lib/effect"
import { codeModeListings, executeTool, toolIdentity } from "../../core/test/lib/tool"
import { host } from "../../core/test/plugin/host"
import { KiloBoard } from "../src/board"
import { fixture } from "./board/support"

const it = testEffect(AppNodeBuilder.build(Tool.node, [Location.node.replace(tempLocationLayer)]))

// The board plugin against the real tool registry: the tools must stay native, because clients render board posts and
// reads by name, and must also be callable as `tools.board_read` / `tools.board_post` inside `execute`.
it.effect("reads and posts the board directly and inside a Code Mode execute", () =>
  Effect.gen(function* () {
    const board = fixture()
    const directory = AbsolutePath.make(board.directory)
    const tools = yield* Tool.Service
    const config = { entries: () => Effect.succeed([]) } as unknown as Config.Interface
    const sessionInfo = (sessionID: string) => {
      const member = board.sessions.get(sessionID)
      if (!member) return Effect.fail(new Error("missing"))
      return Effect.succeed({
        id: member.id,
        parentID: member.parentID,
        projectID: member.projectID,
        title: member.title,
        agent: member.agent,
        location: { directory: member.directory },
        time: { created: DateTime.makeUnsafe(member.created), updated: DateTime.makeUnsafe(member.created) },
      })
    }
    const sessions = {
      get: sessionInfo,
      list: (input: { parentID: string }) =>
        Effect.flatMap(
          Effect.forEach(
            [...board.sessions.values()].filter((member) => member.parentID === input.parentID),
            (member) => sessionInfo(member.id),
          ),
          (data) => Effect.succeed({ data, cursor: {} }),
        ),
      active: Effect.sync(() => new Set<string>()),
    } as unknown as Session.Interface
    const jobs = { get: () => Effect.sync(() => undefined) } as unknown as Job.Interface
    const ctx = host({
      location: new Location.Info({
        directory,
        project: { id: Project.ID.make("board-test"), directory, canonical: directory },
      }),
      storage: board.storage,
      rpc: {
        register: () =>
          Effect.succeed({
            dispose: Effect.void,
            events: { emit: (_: string, _event: KiloBoardRpc.Changed) => Effect.void },
          }),
      } as never,
      tool: {
        transform: tools.transform,
        reload: tools.reload,
        list: tools.list,
        hook: () => Effect.succeed({ dispose: Effect.void }),
      },
      session: { hook: () => Effect.succeed({ dispose: Effect.void }) },
      permission: { assert: () => Effect.void } as never,
      event: { subscribe: () => Stream.empty },
    })

    yield* KiloBoard.Plugin.effect(ctx).pipe(
      Effect.provideService(Config.Service, config),
      Effect.provideService(Session.Service, sessions),
      Effect.provideService(Job.Service, jobs),
    )

    const snapshot = yield* tools.snapshot()
    const native = snapshot.definitions.map((tool) => tool.name)
    expect(native).toContain("board_read")
    expect(native).toContain("board_post")
    expect(codeModeListings(snapshot.codeModeCatalog!).map((entry) => entry.path)).toEqual(["board_post", "board_read"])

    const call = (id: string, name: string, input: unknown) =>
      executeTool(tools, {
        sessionID: Session.ID.make("ses_root"),
        agent: toolIdentity.agent,
        messageID: SessionMessage.ID.make("msg_board"),
        call: { type: "tool-call", id, name, input },
      })

    const posted = yield* call("call_post_nested", "execute", {
      code: 'return await tools.board_post({ to: "ses_child", type: "INFO", body: "nested post" })',
    })
    expect(posted.status).toBe("completed")
    expect(JSON.parse(posted.output.output)).toMatchObject({ from: "main", to: "ses_child", body: "nested post" })

    const read = yield* call("call_read_nested", "execute", { code: "return await tools.board_read({})" })
    expect(read.status).toBe("completed")
    expect(JSON.parse(read.output.output).messages[0]).toMatchObject({ body: "nested post" })

    const direct = yield* call("call_post_direct", "board_post", { to: "ALL", type: "INFO", body: "direct post" })
    expect(direct.status).toBe("completed")
    expect(JSON.parse(direct.content?.[0]?.type === "text" ? direct.content[0].text : "")).toMatchObject({
      body: "direct post",
    })
  }).pipe(Effect.orDie),
)
