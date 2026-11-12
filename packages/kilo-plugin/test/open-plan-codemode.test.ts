import { expect, test } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { host } from "../../core/test/plugin/host"
import { location } from "../../core/test/fixture/location"
import { permissionLayer } from "../../core/test/lib/permission"
import { KiloPlanPlugin } from "../src/plan"
import { code, created, sessionID, workspace } from "./plan-harness"

const session = { id: sessionID, time: { created, updated: created } } as unknown as Session.Info
const planPath = ".kilo2/plans/1000-dark-mode-plan.md"

const registryLayer = AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node]), [
  Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
  Location.node.replace(
    Layer.succeed(
      Location.Service,
      Location.Service.of({
        ...location({ directory: AbsolutePath.make("/workspace") }),
        project: {
          id: Project.ID.global,
          directory: AbsolutePath.make("/workspace"),
          canonical: AbsolutePath.make("/workspace"),
        },
      }),
    ),
  ),
])

test("Code Mode gives the Code agent open_plan and attaches its resolved path without a model path", async () => {
  const space = await workspace()
  const previous = process.env.OPENCODE_CLIENT
  process.env.OPENCODE_CLIENT = "vscode"
  try {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* Tool.Service
          const hooks = yield* PluginHooks.Service
          yield* KiloPlanPlugin.effect(
            host({
              location: space.location,
              permission: { assert: () => Effect.void } as never,
              tool: {
                ...host().tool,
                transform: registry.transform,
                reload: registry.reload,
                list: registry.list,
                hook: ((name: string, callback: (event: never) => Effect.Effect<void>) =>
                  hooks.register("tool", name as never, callback as never)) as never,
              },
              session: {
                ...host().session,
                hook: (() => Effect.succeed({ dispose: Effect.void })) as never,
              },
            }),
          )
          const snapshot = yield* registry.snapshot([{ action: "*", resource: "*", effect: "allow" }])
          expect(snapshot.definitions.map((tool) => tool.name)).toContain("execute")
          expect(snapshot.definitions.map((tool) => tool.name)).not.toContain("open_plan")
          expect(
            CodeModeCatalog.summarize(snapshot.codeModeCatalog!).namespaces.flatMap((namespace) =>
              namespace.entries.map((entry) => entry.path),
            ),
          ).toContain("open_plan")
          return yield* snapshot.execute({
            sessionID,
            agent: code,
            messageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call",
              id: "call-execute",
              name: "execute",
              input: { code: "return await tools.open_plan({})" },
            },
          })
        }),
      ).pipe(
        Effect.provide(registryLayer),
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Global.Service, Global.make({ home: space.root, data: space.data })),
            Layer.mock(SessionStore.Service, {
              get: () => Effect.succeed(session),
              messages: () => Effect.succeed([]),
            }),
            Layer.mock(Bus.Service, { publish: () => Effect.void as never }),
          ),
        ),
      ),
    )
    expect(result.metadata).toEqual({
      toolCalls: [{ tool: "open_plan", status: "completed" }],
      path: planPath,
      open: true,
    })
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = previous
    await space.dispose()
  }
})
