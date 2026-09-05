import { OpenCode } from "@opencode-ai/client"
import { Effect } from "effect"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

const policyConfig = JSON.parse(process.env.KILO_AGENT_POLICY_CONFIG ?? "{}")
const exercise = process.env.KILO_AGENT_POLICY_EXERCISE === "true"
const calls: string[] = []
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body = (await request.json()) as { messages: Array<{ role: string; content?: unknown }> }
    const transcript = JSON.stringify(body.messages)
    const agent = transcript.includes("Exercise ask permissions")
      ? "ask"
      : transcript.includes("Exercise debug permissions")
        ? "debug"
        : undefined
    const tool =
      body.messages.at(-1)?.role === "tool"
        ? undefined
        : agent === undefined
          ? undefined
          : agent === "ask"
            ? { name: "shell", arguments: JSON.stringify({ command: "git status" }) }
            : { name: "read", arguments: JSON.stringify({ path: "secret.txt", offset: 0, limit: 10 }) }
    if (tool) calls.push(`${agent}:${tool.name}`)
    const delta = tool
      ? { tool_calls: [{ index: 0, id: `call_${tool.name}`, type: "function", function: tool }] }
      : { role: "assistant", content: "Fixture complete" }
    const finish = tool ? "tool_calls" : "stop"
    return new Response(
      [
        { choices: [{ index: 0, delta, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: finish }] },
      ]
        .map(
          (frame) =>
            `data: ${JSON.stringify({ id: "agent-policy", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
        )
        .join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})

try {
  const output = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(layout("interactive"), {
          models: false,
          recover: false,
          content: JSON.stringify({
            ...policyConfig,
            model: "fixture/chat",
            providers: {
              fixture: {
                package: "aisdk:@ai-sdk/openai-compatible",
                settings: { baseURL: `${model.url.origin}/v1`, apiKey: "fixture" },
                models: { chat: {} },
              },
            },
          }),
        })
        const client = OpenCode.make({
          baseUrl: server.url,
          headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
        })
        const location = { location: { directory: process.env.KILO_AGENT_POLICY_CWD! } }
        yield* Effect.promise(() => client.plugin.awaitActivation(location))
        const agents = (yield* Effect.promise(() => client.agent.list(location))).data
        if (!exercise) {
          const session = yield* Effect.promise(() => client.session.create(location))
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "Exercise default agent" }))
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          const messages = yield* Effect.promise(() => client.message.list({ sessionID: session.id, order: "asc" }))
          return { agents, defaultAgent: messages.data.find((message) => message.type === "assistant")?.agent }
        }
        const run = (agent: string) =>
          Effect.promise(async () => {
            const session = await client.session.create({
              ...location,
              agent,
              model: { providerID: "fixture", id: "chat" },
            })
            await client.session.prompt({ sessionID: session.id, text: `Exercise ${agent} permissions` })
            await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
            return (await client.permission.list({ sessionID: session.id })).length
          })
        return {
          agents,
          runtime: { calls, askPermissions: yield* run("ask"), debugPermissions: yield* run("debug") },
        }
      }),
    ),
  )
  console.log(JSON.stringify(output))
} finally {
  await model.stop(true)
}
