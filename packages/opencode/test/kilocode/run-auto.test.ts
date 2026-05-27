// kilocode_change - new file
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

afterEach(() => {
  if (tty) {
    Object.defineProperty(process.stdin, "isTTY", tty)
    return
  }
  delete (process.stdin as { isTTY?: boolean }).isTTY
})

async function run(sdk: Record<string, unknown>) {
  mock.module("@kilocode/sdk/v2", () => ({
    createKiloClient: () => sdk,
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
        subscribe: async () => ({ stream: q.stream() }),
      },
      permission: {
        reply: async (input: { requestID: string; reply: string }) => {
          calls.push(input)
          if (input.requestID === "perm_child") done.resolve()
          return { data: true }
        },
      },
      session: {
        prompt: async () => {
          q.push(task("ses_child"))
          q.push(permission("perm_other", "ses_other"))
          q.push(permission("perm_child", "ses_child"))
          q.push(idle())
          await Promise.race([done.promise, new Promise((resolve) => setTimeout(resolve, 25))])
          q.end()
          return { data: undefined }
        },
      },
    }

    await run(sdk)

    expect(calls).toEqual([{ requestID: "perm_child", reply: "once" }])
  })
})
