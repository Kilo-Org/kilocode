import { expect, test } from "bun:test"
import type { AgentSideConnection, RequestPermissionRequest } from "@agentclientprotocol/sdk"
import { createKiloClient, type PermissionRequest } from "@kilocode/sdk/v2"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { createTwoFilesPatch } from "diff"
import { Effect } from "effect"
import path from "node:path"
import { ACPPermission } from "@/acp/permission"
import { ACPSession } from "@/acp/session"
import {
  createPermissionBodyState,
  permissionOptions,
  permissionRun,
  temporaryPermission,
} from "@/cli/cmd/run/permission.shared"
import { tmpdir } from "../../fixture/fixture"

const request = {
  id: "per_test",
  sessionID: "ses_test",
  permission: "edit",
  patterns: [],
  metadata: {},
  always: ["*"],
} satisfies PermissionRequest

test("the interactive run footer offers once and reject and identifies manual approval", () => {
  expect(permissionOptions("permission", temporaryPermission({ ...request, managed: { revision: 7 } }))).toEqual([
    "once",
    "reject",
  ])
  const result = permissionRun(createPermissionBodyState(request.id), request.id, "once")
  expect(result.reply).toEqual({ requestID: request.id, reply: "once", interactive: true })
})

test.each([
  [true, "once"],
  [true, "always"],
  [false, "once"],
] as const)(
  "ACP handles an edit selection without writing from the client (managed=%s, option=%s)",
  async (managed, optionId) => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.txt")
    await Bun.write(filepath, "before\n")
    const prompt = Promise.withResolvers<RequestPermissionRequest>()
    const reply = Promise.withResolvers<{ path: string; body: unknown }>()
    using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        reply.resolve({ path: new URL(req.url).pathname, body: await req.json() })
        return Response.json(true)
      },
    })
    const sdk = createKiloClient({ baseUrl: server.url.href })
    const writes: string[] = []
    const connection = {
      async requestPermission(input) {
        prompt.resolve(input)
        return { outcome: { outcome: "selected", optionId } }
      },
      async writeTextFile(input) {
        writes.push(input.path)
        await Bun.write(input.path, input.content)
        return {}
      },
    } satisfies Pick<AgentSideConnection, "requestPermission" | "writeTextFile">
    const session = await Effect.runPromise(ACPSession.Service.pipe(Effect.provide(LayerNode.compile(ACPSession.node))))
    await Effect.runPromise(session.create({ id: request.sessionID, cwd: tmp.path }))
    new ACPPermission.Handler({ sdk, session, connection }).handle({
      id: "evt_test",
      type: "permission.asked",
      properties: {
        ...request,
        ...(managed ? { managed: { revision: 7 } } : {}),
        metadata: { filepath, diff: createTwoFilesPatch(filepath, filepath, "before\n", "after\n") },
      },
    })

    const offered = await prompt.promise
    expect(offered.options.map((option) => option.optionId)).toEqual(
      managed ? ["once", "reject"] : ["once", "always", "reject"],
    )
    expect(offered.toolCall.content).toEqual([
      { type: "diff", path: filepath, oldText: "before\n", newText: "after\n" },
    ])
    expect(await reply.promise).toEqual({
      path: `/permission/${request.id}/reply`,
      body: { reply: optionId === "once" ? "once" : "reject", interactive: optionId === "once" },
    })
    expect(writes).toEqual([])
    expect(await Bun.file(filepath).text()).toBe("before\n")
  },
)
