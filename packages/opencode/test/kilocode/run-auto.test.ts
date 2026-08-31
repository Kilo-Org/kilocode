import { afterEach, describe, expect, mock, test } from "bun:test"

type Event = {
  type: string
  properties: Record<string, unknown>
}

function feed<T>() {
  const list: T[] = []
  const wait: Array<() => void> = []
  const state = { done: false }

  return {
    push(item: T) {
      list.push(item)
      while (wait.length) wait.shift()?.()
    },
    end() {
      state.done = true
      while (wait.length) wait.shift()?.()
    },
    async *stream() {
      while (!state.done || list.length) {
        if (list.length) {
          yield list.shift() as T
          continue
        }
        await new Promise<void>((resolve) => wait.push(resolve))
      }
    },
  }
}

function task(child: string): Event {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: "prt_task",
        type: "tool",
        tool: "task",
        sessionID: "ses_root",
        state: {
          status: "running",
          input: {
            description: "inspect bug",
            prompt: "check child permissions",
            subagent_type: "general",
          },
          metadata: {
            sessionId: child,
          },
          time: { start: 0 },
        },
      },
    },
  }
}

function permission(id: string, sessionID: string): Event {
  return {
    type: "permission.asked",
    properties: {
      id,
      sessionID,
      permission: "bash",
      patterns: ["npm test"],
      metadata: { command: "npm test" },
      always: ["npm *"],
    },
  }
}

function idle(): Event {
  return {
    type: "session.status",
    properties: {
      sessionID: "ses_root",
      status: { type: "idle" },
    },
  }
}

function args() {
  return {
    _: [],
    $0: "kilo",
    message: ["hi"],
    command: undefined,
    continue: false,
    session: "ses_root",
    fork: false,
    "cloud-fork": false,
    cloudFork: false,
    share: false,
    model: undefined,
    agent: undefined,
    format: "json",
    file: undefined,
    title: undefined,
    attach: "http://127.0.0.1:4096",
    password: undefined,
    dir: undefined,
    port: undefined,
    variant: undefined,
    thinking: false,
    auto: true,
    "dangerously-skip-permissions": false,
    dangerouslySkipPermissions: false,
    "--": [],
  }
}

const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
const exitCode = process.exitCode

afterEach(() => {
  process.exitCode = exitCode ?? 0
  if (tty) {
    Object.defineProperty(process.stdin, "isTTY", tty)
    return
  }
  delete (process.stdin as { isTTY?: boolean }).isTTY
})

async function run(sdk: Record<string, unknown>) {
  mock.module("@kilocode/sdk/v2", () => ({
    createKiloClient: (config: { fetch?: () => Promise<Response> }) => {
      config.fetch = async () =>
        Response.json({
          paths: {
            "/kilocode/session/{sessionID}/drain": { post: { operationId: "kilocode.drainSession" } },
          },
        })
      return sdk
    },
  }))

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  })

  const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
  const { RunCommand } = await import(`../../src/cli/cmd/run?${key}`)
  return RunCommand.handler(args() as never)
}

describe("cli run auto permissions", () => {
  test("auto approves tracked subagent permissions and ignores unrelated sessions", async () => {
    const q = feed<Event>()
    const calls: Array<{ requestID: string; reply: string }> = []
    const done = Promise.withResolvers<void>()

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      event: {
        subscribe: async () => {
          q.push({ type: "server.connected", properties: {} })
          return { stream: q.stream() }
        },
      },
      kilocode: {
        drainSession: async (input: { sessionID: string; token: string }) => {
          q.push({ type: "session.drained", properties: input })
          q.end()
          return { data: true }
        },
      },
      permission: {
        reply: async (input: { requestID: string; reply: string }) => {
          calls.push(input)
          if (input.requestID === "perm_child") done.resolve()
          return { data: true }
        },
      },
      session: {
        get: async (input: { sessionID: string }) => ({
          data: { id: input.sessionID, directory: "/tmp/project" },
        }),
        prompt: async () => {
          q.push(task("ses_child"))
          q.push(permission("perm_other", "ses_other"))
          q.push(permission("perm_child", "ses_child"))
          q.push(idle())
          await done.promise
          return { data: undefined }
        },
      },
    }

    await run(sdk)

    expect(calls).toEqual([{ requestID: "perm_child", reply: "once" }])
  })

  test("a failed prompt aborts a blocked permission reply during cleanup", async () => {
    const q = feed<Event>()
    const started = Promise.withResolvers<void>()
    let aborted = false
    const sdk = {
      config: { get: async () => ({ data: { share: "manual" } }) },
      event: {
        subscribe: async () => {
          q.push({ type: "server.connected", properties: {} })
          return { stream: q.stream() }
        },
      },
      permission: {
        reply: async (_input: unknown, options: { signal: AbortSignal }) => {
          expect(options.signal).toBeInstanceOf(AbortSignal)
          started.resolve()
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => {
                aborted = true
                reject(options.signal.reason)
              },
              { once: true },
            )
          })
        },
      },
      session: {
        get: async (input: { sessionID: string }) => ({ data: { id: input.sessionID, directory: "/tmp/project" } }),
        prompt: async () => {
          q.push(task("ses_child"))
          q.push(permission("perm_child", "ses_child"))
          await started.promise
          throw new Error("intentional prompt failure")
        },
      },
    }
    await run(sdk)
    q.end()
    expect(aborted).toBe(true)
    expect(process.exitCode).toBe(1)
  })

  test("handles a tracked child's network retry without touching another session", async () => {
    const q = feed<Event>()
    const done = Promise.withResolvers<void>()
    const calls: string[] = []
    const sdk = {
      config: { get: async () => ({ data: { share: "manual" } }) },
      event: {
        subscribe: async () => {
          q.push({ type: "server.connected", properties: {} })
          return { stream: q.stream() }
        },
      },
      network: {
        reply: async (input: { requestID: string }, options: { signal: AbortSignal }) => {
          expect(options.signal).toBeInstanceOf(AbortSignal)
          calls.push(input.requestID)
          done.resolve()
          return { data: true }
        },
      },
      kilocode: {
        drainSession: async (input: { sessionID: string; token: string }) => {
          q.push({ type: "session.drained", properties: input })
          q.end()
          return { data: true }
        },
      },
      session: {
        get: async (input: { sessionID: string }) => ({ data: { id: input.sessionID, directory: "/tmp/project" } }),
        prompt: async () => {
          q.push(task("ses_child"))
          q.push({ type: "session.network.asked", properties: { id: "net_other", sessionID: "ses_other" } })
          q.push({ type: "session.network.asked", properties: { id: "net_child", sessionID: "ses_child" } })
          await done.promise
          return { data: undefined }
        },
      },
    }
    await run(sdk)
    expect(calls).toEqual(["net_child"])
  }, 15_000)
})
