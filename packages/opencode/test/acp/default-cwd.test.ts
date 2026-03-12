import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "node:path"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]
type RequestPermissionResult = Awaited<ReturnType<AgentSideConnection["requestPermission"]>>

function createMockConnection() {
  const sessionUpdates: SessionUpdateParams[] = []

  return {
    connection: {
      async sessionUpdate(params: SessionUpdateParams) {
        sessionUpdates.push(params)
      },
      async requestPermission(_params: RequestPermissionParams): Promise<RequestPermissionResult> {
        return { outcome: { outcome: "selected", optionId: "once" } } as RequestPermissionResult
      },
    } as unknown as AgentSideConnection,
    sessionUpdates,
  }
}

function createMockSDK(
  sessionCreateCallback?: (cwd: string) => void,
  sessionGetCallback?: (cwd: string) => void,
  listSessionsCallback?: (cwd: string) => void,
) {
  return {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => {
        const signal = opts?.signal
        return {
          stream: (async function* () {
            while (!signal?.aborted) {
              await new Promise((resolve) => {
                if (signal) {
                  signal.addEventListener("abort", resolve, { once: true })
                }
                setTimeout(resolve, 50)
              })
            }
          })(),
        }
      },
    },
    session: {
      create: async (params?: any) => {
        if (sessionCreateCallback && params?.directory) {
          sessionCreateCallback(params.directory)
        }
        return {
          data: {
            id: `ses_${Date.now()}`,
            time: { created: new Date().toISOString() },
          },
        }
      },
      get: async (params?: any) => {
        if (sessionGetCallback && params?.directory) {
          sessionGetCallback(params.directory)
        }
        return {
          data: {
            id: params?.sessionID || "ses_1",
            time: { created: new Date().toISOString() },
          },
        }
      },
      messages: async () => ({ data: [] }),
      message: async () => ({
        data: {
          info: { role: "assistant" },
          parts: [],
        },
      }),
      list: async (params?: any) => {
        if (listSessionsCallback && params?.directory) {
          listSessionsCallback(params.directory)
        }
        return {
          data: [],
        }
      },
    },
    permission: {
      respond: async () => ({ data: true }),
    },
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "opencode",
              models: {
                "big-pickle": { id: "big-pickle", name: "big-pickle" },
              },
            },
          ],
        },
      }),
    },
    app: {
      agents: async () => ({
        data: [
          {
            name: "code",
            description: "code",
            mode: "agent",
          },
        ],
      }),
    },
    command: {
      list: async () => ({ data: [] }),
    },
    mcp: {
      add: async () => ({ data: true }),
    },
  } as any
}

describe("acp.agent defaultCwd handling", () => {
  test("uses defaultCwd when creating new session without explicit cwd", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defaultCwd = path.join(tmp.path, "project")
        const capturedCwds: string[] = []

        const { connection } = createMockConnection()
        const sdk = createMockSDK((cwd) => capturedCwds.push(cwd))

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultCwd,
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        } as any)

        try {
          await agent.newSession({ mcpServers: [] } as any)

          expect(capturedCwds).toHaveLength(1)
          expect(capturedCwds[0]).toBe(defaultCwd)
        } finally {
          ;(agent as any).eventAbort.abort()
          await new Promise((r) => setTimeout(r, 100))
        }
      },
    })
  })

  test("prefers explicit cwd over defaultCwd when provided", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defaultCwd = path.join(tmp.path, "default")
        const explicitCwd = path.join(tmp.path, "explicit")
        const capturedCwds: string[] = []

        const { connection } = createMockConnection()
        const sdk = createMockSDK((cwd) => capturedCwds.push(cwd))

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultCwd,
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        } as any)

        try {
          await agent.newSession({ cwd: explicitCwd, mcpServers: [] } as any)

          expect(capturedCwds).toHaveLength(1)
          expect(capturedCwds[0]).toBe(explicitCwd)
        } finally {
          ;(agent as any).eventAbort.abort()
          await new Promise((r) => setTimeout(r, 100))
        }
      },
    })
  })

  test("falls back to process.cwd() when no defaultCwd or explicit cwd provided", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capturedCwds: string[] = []

        const { connection } = createMockConnection()
        const sdk = createMockSDK((cwd) => capturedCwds.push(cwd))

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        } as any)

        try {
          await agent.newSession({ mcpServers: [] } as any)

          expect(capturedCwds).toHaveLength(1)
          expect(capturedCwds[0]).toBe(process.cwd())
        } finally {
          ;(agent as any).eventAbort.abort()
          await new Promise((r) => setTimeout(r, 100))
        }
      },
    })
  })

  test("uses defaultCwd for loadSession when cwd not provided", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defaultCwd = path.join(tmp.path, "project")
        const capturedCwds: string[] = []

        const { connection } = createMockConnection()
        const sdk = createMockSDK(undefined, (cwd) => capturedCwds.push(cwd))

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultCwd,
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        } as any)

        try {
          const result = await agent.newSession({ mcpServers: [] } as any)
          capturedCwds.length = 0

          await agent.loadSession({
            sessionId: result.sessionId,
            mcpServers: [],
          } as any)

          expect(capturedCwds).toHaveLength(1)
          expect(capturedCwds[0]).toBe(defaultCwd)
        } finally {
          ;(agent as any).eventAbort.abort()
          await new Promise((r) => setTimeout(r, 100))
        }
      },
    })
  })

  test("uses defaultCwd for unstable_listSessions when cwd not provided", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defaultCwd = path.join(tmp.path, "project")
        const capturedCwds: string[] = []

        const { connection } = createMockConnection()
        const sdk = createMockSDK(undefined, undefined, (cwd) => capturedCwds.push(cwd))

        const agent = new ACP.Agent(connection, {
          sdk,
          defaultCwd,
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        } as any)

        try {
          await agent.unstable_listSessions({} as any)

          expect(capturedCwds).toHaveLength(1)
          expect(capturedCwds[0]).toBe(defaultCwd)
        } finally {
          ;(agent as any).eventAbort.abort()
          await new Promise((r) => setTimeout(r, 100))
        }
      },
    })
  })

  test("defaultCwd is passed through ACP.init to created agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defaultCwd = path.join(tmp.path, "project")
        const capturedCwds: string[] = []

        const { connection } = createMockConnection()
        const sdk = createMockSDK((cwd) => capturedCwds.push(cwd))

        const factory = await ACP.init({ sdk, defaultCwd })
        const agent = factory.create(connection, {
          sdk,
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })

        try {
          await agent.newSession({ mcpServers: [] } as any)

          expect(capturedCwds).toHaveLength(1)
          expect(capturedCwds[0]).toBe(defaultCwd)
        } finally {
          ;(agent as any).eventAbort.abort()
          await new Promise((r) => setTimeout(r, 100))
        }
      },
    })
  })

  test("create() caller-provided defaultCwd takes precedence over init() defaultCwd", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const initCwd = path.join(tmp.path, "init")
        const createCwd = path.join(tmp.path, "create")
        const capturedCwds: string[] = []

        const { connection } = createMockConnection()
        const sdk = createMockSDK((cwd) => capturedCwds.push(cwd))

        // Pass different defaultCwd to init() vs create()
        const factory = await ACP.init({ sdk, defaultCwd: initCwd })
        const agent = factory.create(connection, {
          sdk,
          defaultCwd: createCwd, // This should win
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        } as any)

        try {
          await agent.newSession({ mcpServers: [] } as any)

          expect(capturedCwds).toHaveLength(1)
          expect(capturedCwds[0]).toBe(createCwd) // create-provided wins
        } finally {
          ;(agent as any).eventAbort.abort()
          await new Promise((r) => setTimeout(r, 100))
        }
      },
    })
  })
})
