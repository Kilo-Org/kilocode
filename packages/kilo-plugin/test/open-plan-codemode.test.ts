import { expect, test } from "bun:test"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Permission } from "@opencode/core/permission"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { host } from "../../core/test/plugin/host"
import { permissionLayer } from "../../core/test/lib/permission"
import { openPlan } from "../src/plan/plan"
import { code, created, sessionID, workspace } from "./plan-harness"

const session = { id: sessionID, time: { created, updated: created } } as unknown as Session.Info

const registryLayer = AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node]), [
  Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
])

test("Code Mode gives the Code agent open_plan and forwards its client open request", async () => {
  const space = await workspace()
  try {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* Tool.Service
          const store = yield* SessionStore.Service
          yield* registry.transform((editor) =>
            editor.add(
              openPlan(
                host({ location: space.location, permission: { assert: () => Effect.void } as never }),
                store,
                space.data,
              ),
            ),
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
              input: { code: 'return await tools.open_plan({ path: ".kilo2/plans/1000-dark-mode-plan.md" })' },
            },
          })
        }),
      ).pipe(
        Effect.provide(registryLayer),
        Effect.provide(
          Layer.mock(SessionStore.Service, {
            get: () => Effect.succeed(session),
            messages: () => Effect.succeed([]),
          }),
        ),
      ),
    )
    expect(result.metadata).toEqual({
      toolCalls: [
        { tool: "open_plan", status: "completed", input: { path: ".kilo2/plans/1000-dark-mode-plan.md" } },
      ],
    })
  } finally {
    await space.dispose()
  }
})
