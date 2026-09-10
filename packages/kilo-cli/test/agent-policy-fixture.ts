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
        : transcript.includes("file search specialist")
          ? "explore"
          : undefined
    const tool =
      body.messages.at(-1)?.role === "tool"
        ? undefined
        : agent === undefined
          ? undefined
          : agent === "explore"
            ? exploreTool(transcript)
            : agent === "ask"
              ? { name: "shell", arguments: JSON.stringify({ command: "git status" }) }
              : { name: "read", arguments: JSON.stringify({ path: "secret.txt", offset: 0, limit: 10 }) }
    if (tool) calls.push(`${agent}:${tool.name}`)
    const delta = tool
      ? { tool_calls: [{ index: 0, id: `call_${tool.name}_${calls.length}`, type: "function", function: tool }] }
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

// The Explore prompt advertises the requested command in the user message; the fixture echoes it
// back as the shell tool call so the real permission pipeline decides allow/deny per command.
function exploreTool(transcript: string) {
  const match = transcript.match(/Exercise explore permissions: (.+?)(?:\\n|")/)
  const command = match?.[1]
  if (!command) return undefined
  return { name: "shell", arguments: JSON.stringify({ command }) }
}

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
        const cwd = process.env.KILO_AGENT_POLICY_CWD!
        const location = { location: { directory: cwd } }
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
        const run = (agent: string, command?: string) =>
          Effect.promise(async () => {
            const session = await client.session.create({
              ...location,
              agent,
              model: { providerID: "fixture", id: "chat" },
            })
            const text =
              command === undefined ? `Exercise ${agent} permissions` : `Exercise ${agent} permissions: ${command}`
            await client.session.prompt({ sessionID: session.id, text })
            await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
            const messages = (await client.message.list({ sessionID: session.id, order: "asc" })).data
            return {
              permissions: (await client.permission.list({ sessionID: session.id })).length,
              toolError: messages.some(
                (message) =>
                  message.type === "assistant" &&
                  message.content.some((part) => part.type === "tool" && part.state.status === "error"),
              ),
            }
          })
        const explore = (command: string) => Effect.map(run("explore", command), (result) => result.toolError)
        const redirectError = yield* explore("echo hi > out.txt")
        // The redirect must be denied before spawn, so no child process may create out.txt.
        const redirectWroteFile = yield* Effect.promise(() => Bun.file(`${cwd}/out.txt`).exists())
        return {
          agents,
          runtime: {
            calls,
            askPermissions: (yield* run("ask")).permissions,
            debugPermissions: (yield* run("debug")).permissions,
            explore: {
              cat: yield* explore("cat package.json"),
              gitStatus: yield* explore("git status"),
              gitPush: yield* explore("git push origin main"),
              find: yield* explore("find . -name node_modules -delete"),
              sortOutput: yield* explore("sort -o out.txt input.txt"),
              sortCompress: yield* explore("sort --compress-program=gzip big.txt"),
              rgPre: yield* explore("rg --pre cat secret"),
              chain: yield* explore("cat a.txt; rm b.txt"),
              pipe: yield* explore("cat a.txt | sh"),
              substitution: yield* explore("echo $(whoami)"),
              backtick: yield* explore("echo `whoami`"),
              redirect: redirectError,
              redirectWroteFile,
            },
          },
        }
      }),
    ),
  )
  console.log(JSON.stringify(output))
} finally {
  await model.stop(true)
}
