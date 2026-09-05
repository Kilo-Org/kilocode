import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createClient } from "@kilocode/client"
import { fixture, ready, type Fixture } from "./fixture"

type Client = ReturnType<typeof createClient>
type Completion = {
  stream?: boolean
  messages: { role: string; content?: unknown }[]
  tools?: { function: { name: string } }[]
}

function answer(tool?: { name: string; arguments: string }) {
  const delta = tool
    ? { tool_calls: [{ index: 0, id: "call_swarm", type: "function", function: tool }] }
    : { role: "assistant", content: "fixture completed" }
  return new Response(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] },
    ]
      .map(
        (frame) =>
          `data: ${JSON.stringify({ id: "swarm-fixture", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

async function start(input: Fixture, content: string, enabled: boolean) {
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "swarm-fixture.ts")], {
    cwd: input.cwd,
    env: { ...input.env, KILO_FIXTURE_CONFIG: content, KILO_FIXTURE_SWARM: enabled ? "1" : "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  })
  const errors = new Response(child.stderr).text()
  try {
    const listening = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    const client = createClient({
      baseUrl: listening.value,
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    })
    await client.plugin.awaitActivation({ location: { directory: input.cwd } })
    return {
      client,
      async [Symbol.asyncDispose]() {
        child.kill("SIGTERM")
        expect(await child.exited).toBe(0)
        const diagnostics = await errors
        if (diagnostics) console.error(diagnostics)
      },
    }
  } catch (error) {
    child.kill("SIGTERM")
    await child.exited
    throw new Error(`Swarm fixture failed: ${await errors}`, { cause: error })
  }
}

async function idle(client: Client, sessionID: string) {
  try {
    await client.session.wait({ sessionID }, { signal: AbortSignal.timeout(10_000) })
  } catch (cause) {
    throw new Error(
      JSON.stringify({
        permissions: await client.permission.list({ sessionID }),
        messages: await client.message.list({ sessionID, order: "desc", limit: 2 }),
      }),
      { cause },
    )
  }
}
async function prompt(client: Client, sessionID: string, text: string) {
  await client.session.prompt({ sessionID, text })
  await idle(client, sessionID)
}
async function permission(client: Client, sessionID: string) {
  const until = Date.now() + 8_000
  while (Date.now() < until) {
    const requests = await client.permission.list({ sessionID })
    if (requests[0]) return requests[0]
    await Bun.sleep(10)
  }
  throw new Error("Expected a native board permission request")
}
async function results(client: Client, sessionID: string, name: string) {
  const messages = await client.message.list({ sessionID, order: "asc" })
  return messages.data.flatMap((message) =>
    message.type === "assistant" ? message.content.filter((part) => part.type === "tool" && part.name === name) : [],
  )
}
async function completed(client: Client, sessionID: string, name: string) {
  const result = (await results(client, sessionID, name)).at(-1)
  if (!result || result.type !== "tool" || result.state.status !== "completed")
    throw new Error(`Expected completed ${name}: ${JSON.stringify(result)}`)
  return {
    text: result.state.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
    metadata: result.state.metadata,
  }
}

test("real subagent descendants share a permission-gated board, receive notices and survive a host restart", async () => {
  await using input = await fixture()
  const advertised: string[][] = []
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: Completion = await request.json()
      if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "fixture" } }] })
      advertised.push((body.tools ?? []).map((tool) => tool.function.name))
      if (body.messages.at(-1)?.role === "tool") return answer()
      const text = String(body.messages.findLast((message) => message.role === "user")?.content)
      if (text === "spawn")
        return answer({
          name: "subagent",
          arguments: JSON.stringify({ agent: "worker", description: "Swarm fixture child", prompt: "ordinary" }),
        })
      if (text.startsWith("post:"))
        return answer({
          name: "board_post",
          arguments: JSON.stringify({ to: text.slice(5), type: "INFO", body: "peer finding" }),
        })
      if (text === "read") return answer({ name: "board_read", arguments: JSON.stringify({ limit: 50 }) })
      if (text === "invalid-cursor")
        return answer({ name: "board_read", arguments: JSON.stringify({ since: "foreign" }) })
      if (text === "probe") return answer({ name: "shell", arguments: JSON.stringify({ command: "printf probe" }) })
      return answer()
    },
  })
  const permissions = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "board_post", resource: "*", effect: "ask" },
  ]
  const content = JSON.stringify({
    model: "fixture/chat",
    default_agent: "fixture-main",
    agents: {
      "fixture-main": { mode: "primary", permissions },
      worker: { mode: "subagent", permissions },
      blocked: {
        mode: "primary",
        permissions: [...permissions, { action: "board_post", resource: "*", effect: "deny" }],
      },
    },
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `${model.url.origin}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
  let readerID = ""
  try {
    {
      await using host = await start(input, content, false)
      const session = await host.client.session.create({ location: { directory: input.cwd } })
      await prompt(host.client, session.id, "ordinary")
      expect(advertised.at(-1)).not.toContain("board_read")
      expect(advertised.at(-1)).not.toContain("board_post")
    }
    {
      await using host = await start(input, content, true)
      const client = host.client
      const root = await client.session.create({ location: { directory: input.cwd } })
      await prompt(client, root.id, "spawn")
      await prompt(client, root.id, "spawn")
      const children = (await client.session.list({ parentID: root.id, directory: input.cwd })).data
      expect(children).toHaveLength(2)
      expect(children.every((child) => child.parentID === root.id)).toBe(true)
      const sender = children[0].id
      readerID = children[1].id
      await client.session.prompt({ sessionID: sender, text: `post:${readerID}` })
      const rejected = await permission(client, sender)
      expect(rejected.action).toBe("board_post")
      await client.permission.reply({ sessionID: sender, requestID: rejected.id, reply: "reject" })
      await idle(client, sender)
      await prompt(client, readerID, "read")
      expect(JSON.parse((await completed(client, readerID, "board_read")).text).messages).toEqual([])
      await client.session.prompt({ sessionID: sender, text: `post:${readerID}` })
      const corrected = await permission(client, sender)
      await client.permission.reply({
        sessionID: sender,
        requestID: corrected.id,
        reply: "reject",
        message: "Do not post this finding",
      })
      await idle(client, sender)
      expect(JSON.stringify((await results(client, sender, "board_post")).at(-1)?.state)).toContain(
        "Do not post this finding",
      )
      const admission = { sessionID: sender, text: `post:${readerID}`, id: "msg_swarm_allowed" }
      await client.session.prompt(admission)
      const allowed = await permission(client, sender)
      await client.permission.reply({ sessionID: sender, requestID: allowed.id, reply: "always" })
      await idle(client, sender)
      const posted = await completed(client, sender, "board_post")
      expect(JSON.parse(posted.text.split("\n")[0])).toMatchObject({ from: sender, to: readerID, body: "peer finding" })
      expect(posted.metadata?.shared_agent_board_notice).toBe("activity")
      await client.session.prompt(admission)
      await idle(client, sender)
      await prompt(client, readerID, "read")
      const page = JSON.parse((await completed(client, readerID, "board_read")).text)
      expect(page.messages).toHaveLength(1)
      await prompt(client, readerID, "invalid-cursor")
      expect((await results(client, readerID, "board_read")).at(-1)?.state).toMatchObject({
        status: "error",
        error: { message: "Board cursor is not valid for this session" },
      })
      expect(page.participants.map((participant: { sessionID: string }) => participant.sessionID).sort()).toEqual(
        [root.id, sender, readerID].sort(),
      )
      await prompt(client, readerID, "probe")
      expect((await completed(client, readerID, "shell")).metadata?.shared_agent_board_notice).toBeUndefined()
      await prompt(client, sender, `post:${readerID}`)
      await prompt(client, readerID, "probe")
      expect((await completed(client, readerID, "shell")).text).toContain("<shared-agent-board-notice>")
      await prompt(client, readerID, "probe")
      expect((await completed(client, readerID, "shell")).metadata?.shared_agent_board_notice).toBeUndefined()
      const fork = await client.session.fork({ sessionID: root.id, boundary: { type: "through" } })
      expect(fork.parentID).toBeUndefined()
      await prompt(client, sender, `post:${fork.id}`)
      expect(JSON.stringify((await results(client, sender, "board_post")).at(-1)?.state)).toContain(
        "outside this task tree",
      )
      const moved = path.join(input.directory, "moved")
      await mkdir(moved)
      await client.session.move({ sessionID: sender, directory: moved })
      await client.session.prompt({ sessionID: sender, text: `post:${readerID}` })
      const movedApproval = await permission(client, sender)
      await client.permission.reply({ sessionID: sender, requestID: movedApproval.id, reply: "once" })
      await idle(client, sender)
      expect(JSON.stringify((await results(client, sender, "board_post")).at(-1)?.state)).toContain("boundary")
      const blocked = await client.session.create({ location: { directory: input.cwd }, agent: "blocked" })
      await prompt(client, blocked.id, "post:ALL")
      expect(await client.permission.list({ sessionID: blocked.id })).toEqual([])
      expect((await results(client, blocked.id, "board_post")).at(-1)?.state?.status).not.toBe("completed")
    }
    {
      await using host = await start(input, content, true)
      await prompt(host.client, readerID, "read")
      const page = JSON.parse((await completed(host.client, readerID, "board_read")).text)
      expect(page.messages).toHaveLength(2)
      expect(page.messages.every((message: { body: string }) => message.body === "peer finding")).toBe(true)
    }
  } finally {
    await model.stop(true)
  }
}, 60_000)
