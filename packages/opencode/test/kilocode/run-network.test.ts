import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as SDK from "@kilocode/sdk/v2"
import { RunCommand } from "@/cli/cmd/run"
import { KiloRunDrain } from "@/kilocode/cli/run-drain"

const actual = { ...SDK }

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

function asked(id: number): Event {
  return {
    type: "session.network.asked",
    properties: {
      sessionID: "ses_test",
      id: `req_${id}`,
      message: "Connection refused",
      restored: false,
      time: { created: 0 },
    },
  }
}

function busy(): Event {
  return {
    type: "session.status",
    properties: {
      sessionID: "ses_test",
      status: { type: "busy" },
    },
  }
}

function idle(): Event {
  return {
    type: "session.status",
    properties: {
      sessionID: "ses_test",
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
    session: "ses_test",
    fork: false,
    "cloud-fork": false,
    cloudFork: false,
    share: false,
    model: undefined,
    agent: undefined,
    format: "default",
    file: undefined,
    title: undefined,
    attach: "http://127.0.0.1:4096",
    password: undefined,
    dir: undefined,
    port: undefined,
    variant: undefined,
    thinking: false,
    auto: false,
    "--": [],
  }
}

const exitCode = process.exitCode
const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
const text = Bun.stdin.text

afterEach(async () => {
  await mock.module("@kilocode/sdk/v2", () => actual)
  process.exitCode = exitCode ?? 0
  Bun.stdin.text = text
  if (tty) {
    Object.defineProperty(process.stdin, "isTTY", tty)
    return
  }
  delete (process.stdin as { isTTY?: boolean }).isTTY
})

async function run(
  sdk: Record<string, unknown>,
  q: ReturnType<typeof feed<Event>>,
  overrides: Record<string, unknown> = {},
  terminal = true,
) {
  sdk.event = {
    subscribe: async () => {
      q.push({ type: "server.connected", properties: {} })
      return { stream: q.stream() }
    },
  }
  sdk.kilocode = {
    drainSession: async (input: { sessionID: string; token: string }) => {
      q.push({ type: "session.drained", properties: input })
      q.end()
      return { data: true }
    },
  }
  await mock.module("@kilocode/sdk/v2", () => ({
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
    value: terminal,
  })

  const create = KiloRunDrain.create
  const clock = spyOn(KiloRunDrain, "create").mockImplementation((id) => ({
    ...create(id),
    pause: async () => undefined,
  }))
  try {
    return await RunCommand.handler({ ...args(), ...overrides } as never)
  } finally {
    clock.mockRestore()
  }
}

describe("cli run network retries", () => {
  test("rejects after repeated offline resumes without busy", async () => {
    const q = feed<Event>()
    const calls: string[] = []
    const gate = Promise.withResolvers<void>()
    const state = { reject: undefined as string | undefined }

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      network: {
        reply: async (input: { requestID: string }) => {
          calls.push(input.requestID)
          q.push(asked(calls.length + 1))
        },
        reject: async (input: { requestID: string }) => {
          state.reject = input.requestID
          q.push(idle())
          gate.resolve()
        },
      },
      session: {
        get: async (input: { sessionID: string }) => ({
          data: { id: input.sessionID, directory: "/tmp/project" },
        }),
        prompt: async () => {
          q.push(asked(1))
          await gate.promise
          return { data: undefined }
        },
      },
    }

    await run(sdk, q)

    expect(calls).toStrictEqual(["req_1", "req_2", "req_3"])
    expect(state.reject).toBe("req_4")
  })

  test("resets retry budget only after the session is busy again", async () => {
    const q = feed<Event>()
    const calls: string[] = []
    const gate = Promise.withResolvers<void>()
    const state = { reject: undefined as string | undefined }

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      network: {
        reply: async (input: { requestID: string }) => {
          calls.push(input.requestID)
          if (calls.length === 1) {
            q.push(busy())
            q.push(asked(2))
            return
          }
          if (calls.length < 4) {
            q.push(asked(calls.length + 1))
            return
          }
          q.push(idle())
          gate.resolve()
        },
        reject: async (input: { requestID: string }) => {
          state.reject = input.requestID
          q.push(idle())
          gate.resolve()
        },
      },
      session: {
        get: async (input: { sessionID: string }) => ({
          data: { id: input.sessionID, directory: "/tmp/project" },
        }),
        prompt: async () => {
          q.push(asked(1))
          await gate.promise
          return { data: undefined }
        },
      },
    }

    await run(sdk, q)

    expect(calls).toStrictEqual(["req_1", "req_2", "req_3", "req_4"])
    expect(state.reject).toBeUndefined()
  })

  test("built-in compaction uses the session model without reading stdin", async () => {
    const q = feed<Event>()
    const calls: unknown[] = []
    Bun.stdin.text = async () => {
      throw new Error("stdin should not be read")
    }

    const sdk = {
      command: {
        list: async () => ({ data: [] }),
      },
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      session: {
        get: async (input: { sessionID: string }) => ({
          data: {
            id: input.sessionID,
            directory: "/tmp/project",
            model: { providerID: "session-provider", id: "session-model" },
          },
        }),
        summarize: async (input: unknown) => {
          calls.push(input)
          q.push(idle())
          return { data: true }
        },
      },
    }

    await run(sdk, q, { command: "compact", message: [] }, false)

    expect(calls).toEqual([
      {
        sessionID: "ses_test",
        directory: "/tmp/project",
        providerID: "session-provider",
        modelID: "session-model",
      },
    ])
  })

  test("custom compact commands retain piped arguments without a session", async () => {
    const q = feed<Event>()
    const calls: unknown[] = []
    Bun.stdin.text = async () => "from stdin"

    const sdk = {
      command: {
        list: async () => ({ data: [{ name: "compact" }] }),
      },
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      session: {
        create: async () => ({
          data: { id: "ses_created", directory: "/tmp/project" },
        }),
        command: async (input: unknown) => {
          calls.push(input)
          q.push({
            type: "session.status",
            properties: { sessionID: "ses_created", status: { type: "idle" } },
          })
          return { data: undefined }
        },
        summarize: async () => {
          throw new Error("custom command should not summarize")
        },
      },
    }

    await run(sdk, q, { command: "compact", continue: false, session: undefined, message: ["argument"] }, false)

    expect(calls).toEqual([
      {
        sessionID: "ses_created",
        agent: undefined,
        model: undefined,
        command: "compact",
        arguments: "argument\nfrom stdin",
        variant: undefined,
      },
    ])
  })
})
