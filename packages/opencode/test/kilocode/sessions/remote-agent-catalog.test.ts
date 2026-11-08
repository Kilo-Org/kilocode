import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { RemoteAgentCatalog } from "../../../src/kilo-sessions/remote-agent-catalog"
import { RemoteSender } from "../../../src/kilo-sessions/remote-sender"
import type { RemoteProtocol } from "../../../src/kilo-sessions/remote-protocol"
import type { RemoteWS } from "../../../src/kilo-sessions/remote-ws"
import type { Agent } from "../../../src/agent/agent"
import { SessionID } from "../../../src/session/schema"
import { Filesystem } from "../../../src/util/filesystem"
import { disposeAllInstances, provideTestInstance, tmpdir } from "../../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
})

const log = { info: () => {}, error: () => {}, warn: () => {} }

function connect() {
  const sent: RemoteProtocol.Outbound[] = []
  const waits = new Map<string, (msg: RemoteProtocol.Outbound) => void>()
  const conn = {
    send(msg: RemoteProtocol.Outbound) {
      sent.push(msg)
      if (msg.type === "response") waits.get(msg.id)?.(msg)
    },
    close() {},
    async heartbeat() {},
    get connected() {
      return true
    },
  } as RemoteWS.Connection
  const response = (id: string) => {
    const done = Promise.withResolvers<RemoteProtocol.Outbound>()
    waits.set(id, done.resolve)
    return done.promise
  }
  return { conn, sent, response }
}

function agent(input: Partial<Agent.Info> & { name: string }): Agent.Info {
  return { mode: "primary", permission: [], options: {}, ...input }
}

describe("list_agents", () => {
  test("lists the project's primary agents for a sessionless request in a launch subdirectory", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await mkdir(path.join(dir, "app"))
        await Filesystem.write(
          path.join(dir, ".kilo", "agents", "swift-vibecoder.md"),
          "---\ndescription: Builds Swift apps\nmode: primary\n---\nYou write Swift.",
        )
        await Filesystem.write(
          path.join(dir, ".kilo", "agents", "swift-test-writer.md"),
          "---\ndescription: Writes Swift tests\nmode: subagent\n---\nYou write tests.",
        )
      },
    })
    const wire = connect()
    const sender = RemoteSender.create({
      conn: wire.conn,
      directory: tmp.path,
      log,
      provide: (input) => provideTestInstance(input),
    })

    const done = wire.response("req_agents")
    sender.handle({
      type: "command",
      id: "req_agents",
      command: "list_agents",
      data: { protocolVersion: 1, directory: "app" },
    })
    const msg = await done

    if (msg.type !== "response" || !msg.result) throw new Error(`unexpected response: ${JSON.stringify(msg)}`)
    const result = RemoteAgentCatalog.Response.parse(msg.result)
    const names = result.agents.map((item) => item.name)
    expect(result.agents).toContainEqual({ name: "swift-vibecoder", description: "Builds Swift apps" })
    expect(names).not.toContain("swift-test-writer")
    expect(names).not.toContain("compaction")
  })

  test("resolves a session-scoped request in the session's directory and a directory field in the launch tree", async () => {
    await using tmp = await tmpdir({ init: (dir) => mkdir(path.join(dir, "app")) })
    const wire = connect()
    const dirs: string[] = []
    const sender = RemoteSender.create({
      conn: wire.conn,
      directory: tmp.path,
      log,
      provide: async (input) => {
        dirs.push(input.directory)
        return input.fn()
      },
      catalog: {
        get: async (id) => ({ id, directory: "/workspace/session-dir" }) as never,
        messages: async () => [],
        providers: async () => ({}),
        default: async () => undefined,
      },
      agents: { list: async () => [agent({ name: "reviewer" })] },
    })

    const session = wire.response("req_session")
    sender.handle({
      type: "command",
      id: "req_session",
      command: "list_agents",
      sessionId: SessionID.make("ses_agents"),
      data: { protocolVersion: 1 },
    })
    const launch = wire.response("req_launch")
    sender.handle({ type: "command", id: "req_launch", command: "list_agents", data: { protocolVersion: 1 } })
    const child = wire.response("req_child")
    sender.handle({
      type: "command",
      id: "req_child",
      command: "list_agents",
      sessionId: SessionID.make("ses_agents"),
      data: { protocolVersion: 1, directory: "app" },
    })
    await Promise.all([session, launch, child])

    const real = Filesystem.resolve(tmp.path)
    expect(dirs.toSorted()).toEqual(["/workspace/session-dir", tmp.path, path.join(real, "app")].toSorted())
    expect(wire.sent).toContainEqual({
      type: "response",
      id: "req_session",
      result: { protocolVersion: 1, agents: [{ name: "reviewer" }] },
    })
  })

  test("rejects a directory outside the launch tree and a malformed request without listing", async () => {
    await using tmp = await tmpdir()
    const wire = connect()
    const dirs: string[] = []
    const sender = RemoteSender.create({
      conn: wire.conn,
      directory: tmp.path,
      log,
      provide: async (input) => {
        dirs.push(input.directory)
        return input.fn()
      },
      agents: { list: async () => [] },
    })

    sender.handle({
      type: "command",
      id: "req_escape",
      command: "list_agents",
      data: { protocolVersion: 1, directory: ".." },
    })
    sender.handle({ type: "command", id: "req_bad", command: "list_agents", data: { protocolVersion: 2 } })

    expect(wire.sent).toEqual([
      { type: "response", id: "req_escape", error: "invalid list_agents directory" },
      { type: "response", id: "req_bad", error: "invalid list_agents command" },
    ])
    expect(dirs).toEqual([])
  })
})

describe("RemoteAgentCatalog.build", () => {
  test("drops hidden and subagent-only agents, shortens long descriptions, and drops unfit names", () => {
    const result = RemoteAgentCatalog.build([
      agent({
        name: "code",
        displayName: "Code",
        description: "x".repeat(RemoteAgentCatalog.MAX_DESCRIPTION_LENGTH + 5),
      }),
      agent({ name: "everywhere", mode: "all" }),
      agent({ name: "helper", mode: "subagent" }),
      agent({ name: "title", hidden: true }),
      agent({ name: "n".repeat(RemoteAgentCatalog.MAX_NAME_LENGTH + 1) }),
    ])

    expect(result).toEqual({
      protocolVersion: 1,
      agents: [
        { name: "code", displayName: "Code", description: "x".repeat(RemoteAgentCatalog.MAX_DESCRIPTION_LENGTH) },
        { name: "everywhere" },
      ],
    })
  })
})
