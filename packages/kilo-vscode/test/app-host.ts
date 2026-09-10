import { Effect, Schema } from "effect"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { launch } from "../../kilo-cli/src/interactive-server"
import { guardedFixtureLayout } from "../../kilo-cli/test/fixture"
import { startLocalServer } from "../src/local-server"
import { stop } from "../../kilo-cli/src/daemon"
import { connectV2 } from "../src/connection"

// Shared real host for browser and installed-IDE acceptance; both wrappers
// place this entire process tree under external-network denial.
export const appHost = createAppHost(false)
export const managedAppHost = createAppHost(true)

function createAppHost(managed: boolean) {
  return Effect.gen(function* () {
    const layout = guardedFixtureLayout()
    const requests: string[] = []
    const model = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            if (new URL(request.url).pathname === "/api/openrouter/models") return Response.json({ data: [] })
            if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
            const body = await request.text()
            requests.push(body)
            const messages = Schema.decodeUnknownSync(
              Schema.Struct({ messages: Schema.Array(Schema.Struct({ role: Schema.String })) }),
            )(JSON.parse(body)).messages
            const permission = body.includes("Exercise browser permission")
            const tool = permission && messages.at(-1)?.role !== "tool"
            const frames = [
              {
                delta: tool
                  ? {
                      tool_calls: [
                        {
                          index: 0,
                          id: "browser_shell",
                          type: "function",
                          function: {
                            name: "shell",
                            arguments: JSON.stringify({ command: "echo browser-permission" }),
                          },
                        },
                      ],
                    }
                  : {
                      role: "assistant",
                      content: permission ? "Browser permission complete" : "Browser fixture reply",
                    },
                finish_reason: null,
              },
              { delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
            ]
            return new Response(
              frames
                .map(
                  (frame) =>
                    `data: ${JSON.stringify({
                      id: "browser-fixture",
                      object: "chat.completion.chunk",
                      model: "chat",
                      created: 1,
                      choices: [{ index: 0, ...frame }],
                    })}\n\n`,
                )
                .join("") + "data: [DONE]\n\n",
              { headers: { "content-type": "text/event-stream" } },
            )
          },
        }),
      ),
      (model) => Effect.sync(() => model.stop(true)),
    )
    yield* Effect.promise(async () => {
      await mkdir(path.dirname(layout.config), { recursive: true })
      await Bun.write(
        layout.config,
        JSON.stringify({
          model: "fixture/chat",
          permissions: [{ action: "shell", resource: "*", effect: "ask" }],
          providers: {
            fixture: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { baseURL: `${model.url.origin}/v1`, apiKey: "fixture" },
              models: { chat: {} },
            },
          },
        }),
      )
    })
    const server = managed
      ? yield* Effect.acquireRelease(
          Effect.promise(async () => {
            process.env.KILO_API_URL = model.url.origin
            const endpoint = await startLocalServer({
              extensionRoot: path.resolve(import.meta.dir, ".."),
              directory: process.cwd(),
            })
            const reused = await startLocalServer({
              extensionRoot: path.resolve(import.meta.dir, ".."),
              directory: process.cwd(),
            })
            if (endpoint.health.pid !== reused.health.pid) throw new Error("Automatic start did not reuse the daemon")
            console.log("Managed daemon cold start and reuse verified")
            return { url: endpoint.url, auth: { password: endpoint.password } }
          }),
          () => Effect.promise(() => stop(layout)),
        )
      : yield* launch(layout, { models: false, recover: false, projectConfig: true })
    const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
    const session = yield* Effect.promise(() =>
      verified.client.session.create({
        title: "IDE browser acceptance",
        location: { directory: process.cwd() },
        agent: "build",
        model: { providerID: "fixture", id: "chat" },
      }),
    )
    return { layout, server, verified, session, requests }
  })
}
