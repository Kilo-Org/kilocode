import { afterEach, describe, expect, it, jest } from "bun:test"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import { SessionSleepInhibitor, SleepInhibitor, SleepInhibitorService } from "../../src/services/sleep-inhibitor"

class Process extends EventEmitter {
  readonly stdin: PassThrough | null
  readonly stdout = new PassThrough()
  kills = 0
  result = true

  constructor(input: boolean) {
    super()
    this.stdin = input ? new PassThrough() : null
  }

  kill(): boolean {
    this.kills += 1
    return this.result
  }
}

type Call = {
  cmd: string
  args: string[]
  output: boolean
  input: boolean
  child: Process
}

type Setup = {
  platform?: NodeJS.Platform
  pid?: number
  retry?: (attempt: number) => number
  startup?: number
}

const inhibitors: SleepInhibitor[] = []

afterEach(() => {
  for (const inhibitor of inhibitors) inhibitor.dispose()
  inhibitors.length = 0
  jest.useRealTimers()
})

function setup(opts: Setup = {}) {
  const calls: Call[] = []
  const logs: string[] = []
  const states: boolean[] = []
  const inhibitor = new SleepInhibitor({
    platform: opts.platform ?? "linux",
    pid: opts.pid,
    retry: opts.retry,
    startup: opts.startup,
    log: (message) => logs.push(message),
    active: (active) => states.push(active),
    launch: (cmd, args, output, input) => {
      const child = new Process(input)
      calls.push({ cmd, args, output, input, child })
      return child
    },
  })
  inhibitors.push(inhibitor)
  const session = (enabled = true, timeout = 60_000) =>
    new SessionSleepInhibitor(inhibitor, enabled, {
      timeout: () => timeout,
      now: () => Date.now(),
      log: (message) => logs.push(message),
    })
  return { calls, logs, states, inhibitor, session }
}

function item(calls: Call[], index = 0): Call {
  const call = calls.at(index)
  if (!call) throw new Error(`Expected process call ${index}`)
  return call
}

function spawn(call: Call): void {
  call.child.emit("spawn")
  if (call.output) call.child.stdout.write("KILO_SLEEP_INHIBITOR_READY\n")
}

function exit(call: Call): void {
  call.child.emit("exit", 0, null)
}

function stopped(call: Call): boolean {
  return call.child.kills > 0 || call.child.stdin?.writableEnded === true
}

function tracked(service: SleepInhibitorService): string[] {
  return (service as unknown as { sessions: SessionSleepInhibitor }).sessions.ids()
}

function blocked(service: SleepInhibitorService, sessionID: string): string[] {
  const sessions = (service as unknown as { sessions: { waiting: Map<string, Set<string>> } }).sessions
  return [...(sessions.waiting.get(sessionID) ?? [])].sort()
}

function title(service: SleepInhibitorService, sessionID: string): string | undefined {
  const sessions = (service as unknown as { sessions: { tasks: Map<string, { title: string }> } }).sessions
  return sessions.tasks.get(sessionID)?.title
}

function backend(
  session: object,
  prompts: {
    questions?: object[]
    permissions?: object[]
    network?: object[]
    suggestions?: object[] | Record<string, object[]>
    queries?: string[]
    q2?: object[]
    p2?: object[]
    fail?: string[]
  } = {},
) {
  return {
    session,
    question: { list: async () => ({ data: prompts.questions ?? [] }) },
    permission: { list: async () => ({ data: prompts.permissions ?? [] }) },
    network: { list: async () => ({ data: prompts.network ?? [] }) },
    suggestion: {
      list: async (input: { directory?: string } = {}) => {
        const directory = input.directory ?? ""
        prompts.queries?.push(directory)
        const data = Array.isArray(prompts.suggestions) ? prompts.suggestions : (prompts.suggestions?.[directory] ?? [])
        return prompts.fail?.includes("suggestion") ? { error: "suggestion failed" } : { data }
      },
    },
    v2: {
      question: {
        request: {
          list: async () =>
            prompts.fail?.includes("q2") ? { error: "q2 failed" } : { data: { data: prompts.q2 ?? [] } },
        },
      },
      permission: { request: { list: async () => ({ data: { data: prompts.p2 ?? [] } }) } },
    },
  }
}

describe("SleepInhibitor", () => {
  it("becomes active only after the native process confirms startup", () => {
    const test = setup()
    test.inhibitor.acquire("task")

    expect(test.inhibitor.isActive()).toBe(false)
    expect(test.states).toEqual([])

    const call = item(test.calls)
    call.child.emit("spawn")

    expect(test.inhibitor.isActive()).toBe(false)
    call.child.stdout.write("KILO_SLEEP_INHIBITOR_READY\n")

    expect(test.inhibitor.isActive()).toBe(true)
    expect(test.states).toEqual([true])
  })

  it("requires the Windows readiness marker instead of the spawn event", () => {
    const test = setup({ platform: "win32" })
    test.inhibitor.acquire("task")
    const call = item(test.calls)

    call.child.emit("spawn")
    expect(test.inhibitor.isActive()).toBe(false)

    call.child.stdout.write("prefix KILO_SLEEP_INHIBITOR_READY suffix\n")

    expect(test.inhibitor.isActive()).toBe(true)
    expect(test.states).toEqual([true])
  })

  it("uses a parent-pipe watchdog on macOS without blocking display sleep", () => {
    const test = setup({ platform: "darwin", pid: 4242 })
    test.inhibitor.acquire("task")

    expect(item(test.calls)).toMatchObject({
      cmd: "/usr/bin/caffeinate",
      args: ["-i", "/bin/sh", "-c", expect.stringContaining("KILO_SLEEP_INHIBITOR_READY")],
      output: true,
      input: true,
    })
  })

  it("uses a parent-pipe watchdog for both Linux inhibitors", () => {
    const test = setup()
    test.inhibitor.acquire("task")
    const first = item(test.calls)

    expect(first.input).toBe(true)
    expect(first.args).toContain("/bin/sh")
    expect(first.args).not.toContain("idle")

    first.child.emit("error", new Error("missing"))
    const second = item(test.calls, 1)
    expect(second.input).toBe(true)
    expect(second.args).toContain("/bin/sh")
    expect(second.args).not.toContain("--inhibit-only")
  })

  it("uses a Windows parent handle and system-only execution state", () => {
    const test = setup({ platform: "win32", pid: 4242 })
    test.inhibitor.acquire("task")
    const call = item(test.calls)
    const script = call.args.join(" ")

    expect(call.cmd).toBe("powershell.exe")
    expect(call.output).toBe(true)
    expect(call.input).toBe(false)
    expect(call.args).toContain("Hidden")
    expect(script).toContain("OpenProcess(1048576, $false, [uint32]4242)")
    expect(script).toContain("WaitForSingleObject($parent")
    expect(script).toContain("CloseHandle($parent)")
    expect(script).toContain("2147483649")
    expect(script).toContain("2147483648")
    expect(script).not.toContain("ES_DISPLAY_REQUIRED")
    expect(script).not.toContain("2147483650")
  })

  it("keeps one process until every task releases its handle", () => {
    const test = setup()
    const first = test.inhibitor.acquire("first")
    const second = test.inhibitor.acquire("second")
    const call = item(test.calls)
    spawn(call)

    expect(test.calls).toHaveLength(1)
    test.inhibitor.release(first)
    expect(stopped(call)).toBe(false)
    expect(test.inhibitor.isActive()).toBe(true)

    test.inhibitor.release(second)
    expect(stopped(call)).toBe(true)
  })

  it("stays active until the stopped process confirms exit", () => {
    const test = setup()
    const handle = test.inhibitor.acquire("task")
    const call = item(test.calls)
    spawn(call)

    test.inhibitor.release(handle)

    expect(stopped(call)).toBe(true)
    expect(test.inhibitor.isActive()).toBe(true)
    expect(test.states).toEqual([true])

    exit(call)

    expect(test.inhibitor.isActive()).toBe(false)
    expect(test.states).toEqual([true, false])
  })

  it("retains tracking and logs when process termination fails", () => {
    const test = setup({ platform: "win32" })
    const handle = test.inhibitor.acquire("task")
    const call = item(test.calls)
    call.child.result = false
    spawn(call)

    test.inhibitor.release(handle)

    expect(stopped(call)).toBe(true)
    expect(test.inhibitor.isActive()).toBe(true)
    expect(test.logs.some((message) => message.includes("could not be terminated"))).toBe(true)

    exit(call)
    expect(test.inhibitor.isActive()).toBe(false)
  })

  it("starts a replacement after a closing process exits when work resumed", () => {
    const test = setup()
    const first = test.inhibitor.acquire("first")
    const call = item(test.calls)
    spawn(call)

    test.inhibitor.release(first)
    test.inhibitor.acquire("second")
    expect(test.calls).toHaveLength(1)

    exit(call)

    expect(test.calls).toHaveLength(2)
    expect(item(test.calls, 1).cmd).toBe("systemd-inhibit")
  })

  it("starts a replacement after a closing helper fails to spawn", () => {
    const test = setup()
    const first = test.inhibitor.acquire("first")
    const call = item(test.calls)

    test.inhibitor.release(first)
    call.child.emit("error", new Error("ENOENT"))
    const second = test.inhibitor.acquire("second")
    expect(test.calls).toHaveLength(1)

    call.child.emit("close", null, null)

    expect(test.calls).toHaveLength(2)
    expect(item(test.calls, 1).cmd).toBe("systemd-inhibit")
    test.inhibitor.release(second)
  })

  it("falls back on Linux before scheduling a retry", () => {
    jest.useFakeTimers()
    const test = setup({ retry: () => 100 })
    test.inhibitor.acquire("task")

    item(test.calls).child.emit("error", new Error("ENOENT"))
    expect(item(test.calls, 1).cmd).toBe("gnome-session-inhibit")

    item(test.calls, 1).child.emit("error", new Error("ENOENT"))
    expect(test.calls).toHaveLength(2)
    expect(test.logs.some((message) => message.includes("tasks will continue normally"))).toBe(true)

    jest.advanceTimersByTime(99)
    expect(test.calls).toHaveLength(2)
    jest.advanceTimersByTime(1)
    expect(item(test.calls, 2).cmd).toBe("systemd-inhibit")
  })

  it("uses increasing backoff and cancels a pending retry after release", () => {
    jest.useFakeTimers()
    const delays: number[] = []
    const test = setup({
      retry: (attempt) => {
        const wait = (attempt + 1) * 100
        delays.push(wait)
        return wait
      },
    })
    const handle = test.inhibitor.acquire("task")

    item(test.calls).child.emit("error", new Error("missing"))
    item(test.calls, 1).child.emit("error", new Error("missing"))
    jest.advanceTimersByTime(100)
    item(test.calls, 2).child.emit("error", new Error("missing"))
    item(test.calls, 3).child.emit("error", new Error("missing"))

    expect(delays).toEqual([100, 200])
    test.inhibitor.release(handle)
    jest.advanceTimersByTime(1_000)
    expect(test.calls).toHaveLength(4)
  })

  it("keeps increasing backoff when helpers confirm startup and then exit", () => {
    jest.useFakeTimers()
    const delays: number[] = []
    const test = setup({
      retry: (attempt) => {
        const wait = (attempt + 1) * 100
        delays.push(wait)
        return wait
      },
    })
    test.inhibitor.acquire("task")

    spawn(item(test.calls))
    exit(item(test.calls))
    spawn(item(test.calls, 1))
    exit(item(test.calls, 1))
    expect(delays).toEqual([100])

    jest.advanceTimersByTime(100)
    spawn(item(test.calls, 2))
    exit(item(test.calls, 2))
    spawn(item(test.calls, 3))
    exit(item(test.calls, 3))

    expect(delays).toEqual([100, 200])
  })

  it("cancels startup probing after a successful spawn", () => {
    jest.useFakeTimers()
    const test = setup({ startup: 50 })
    test.inhibitor.acquire("task")
    const call = item(test.calls)
    spawn(call)

    jest.advanceTimersByTime(100)

    expect(call.child.kills).toBe(0)
    expect(test.calls).toHaveLength(1)
    expect(test.inhibitor.isActive()).toBe(true)
  })

  it("keeps an unconfirmed helper tracked until exit before falling back", () => {
    jest.useFakeTimers()
    const test = setup({ startup: 50 })
    test.inhibitor.acquire("task")
    const call = item(test.calls)

    jest.advanceTimersByTime(50)

    expect(stopped(call)).toBe(true)
    expect(test.calls).toHaveLength(1)
    expect(test.inhibitor.isActive()).toBe(false)

    exit(call)
    expect(item(test.calls, 1).cmd).toBe("gnome-session-inhibit")
  })
})

describe("SessionSleepInhibitor", () => {
  it("does not launch a process when disabled", () => {
    const test = setup()
    const sessions = test.session(false)

    sessions.status("one", { type: "busy" })
    expect(test.calls).toHaveLength(0)

    sessions.configure(true)
    expect(test.calls).toHaveLength(1)
  })

  it("tracks concurrent session completion, failure, and cancellation", () => {
    const test = setup()
    const sessions = test.session()

    sessions.status("success", { type: "busy" })
    sessions.status("failure", { type: "retry", attempt: 1, message: "retry", next: 1 })
    sessions.status("cancelled", { type: "busy" })
    sessions.status("success", { type: "idle" })
    sessions.remove("failure")

    expect(item(test.calls).child.kills).toBe(0)
    sessions.status("cancelled", { type: "idle" })
    expect(stopped(item(test.calls))).toBe(true)
  })

  it("uses the task title instead of its identifier in the inhibition reason", () => {
    const test = setup()
    const sessions = test.session()

    sessions.status("ses_123", { type: "busy" }, "Refactor settings")

    expect(item(test.calls).args).toContain('--why=Task "Refactor settings" is running')
  })

  it("updates a title without interrupting active inhibition", () => {
    const test = setup()
    const sessions = test.session()

    sessions.status("one", { type: "busy" }, "Old title")
    const first = item(test.calls)
    spawn(first)
    sessions.title("one", "New title")

    expect(stopped(first)).toBe(false)
    expect(test.calls).toHaveLength(1)
  })

  it("does not interrupt another task when the displayed task completes", () => {
    const test = setup()
    const sessions = test.session()

    sessions.status("one", { type: "busy" }, "First task")
    sessions.status("two", { type: "busy" }, "Second task")
    const first = item(test.calls)
    spawn(first)
    sessions.remove("one")

    expect(stopped(first)).toBe(false)
    expect(test.calls).toHaveLength(1)
    sessions.remove("two")
    expect(stopped(first)).toBe(true)
  })

  it("suspends the active budget while waiting and resumes the remainder", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(0))
    const test = setup()
    const sessions = test.session(true, 100)

    sessions.status("one", { type: "busy" }, "Plan release")
    const first = item(test.calls)
    spawn(first)
    jest.advanceTimersByTime(40)
    sessions.pause("one", "question-1")
    exit(first)

    jest.advanceTimersByTime(1_000)
    sessions.resume("one", "question-1")
    const second = item(test.calls, 1)
    spawn(second)

    jest.advanceTimersByTime(59)
    expect(stopped(second)).toBe(false)
    jest.advanceTimersByTime(1)
    expect(stopped(second)).toBe(true)
    expect(test.logs.filter((message) => message.includes("Safety timeout"))).toHaveLength(1)
  })

  it("resumes only after the last answer without charging paused time twice", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(0))
    const test = setup()
    const sessions = test.session(true, 100)

    sessions.status("one", { type: "busy" })
    const first = item(test.calls)
    spawn(first)
    jest.advanceTimersByTime(30)
    sessions.pause("one", "question-1")
    exit(first)

    jest.advanceTimersByTime(500)
    sessions.pause("one", "question-2")
    jest.advanceTimersByTime(500)
    sessions.resume("one", "question-1")
    expect(test.calls).toHaveLength(1)

    sessions.resume("one", "question-2")
    const second = item(test.calls, 1)
    spawn(second)
    jest.advanceTimersByTime(69)
    expect(stopped(second)).toBe(false)
    jest.advanceTimersByTime(1)
    expect(stopped(second)).toBe(true)
  })

  it("does not reset the active budget on repeated busy or retry status", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(0))
    const test = setup()
    const sessions = test.session(true, 100)

    sessions.status("one", { type: "busy" })
    const call = item(test.calls)
    spawn(call)
    jest.advanceTimersByTime(60)
    sessions.status("one", { type: "retry", attempt: 1, message: "retry", next: 1 })
    jest.advanceTimersByTime(39)
    expect(stopped(call)).toBe(false)
    jest.advanceTimersByTime(1)
    expect(stopped(call)).toBe(true)
  })

  it("preserves the active budget while a network request is offline", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(0))
    const test = setup()
    const sessions = test.session(true, 100)

    sessions.status("one", { type: "busy" })
    const first = item(test.calls)
    spawn(first)
    jest.advanceTimersByTime(40)
    sessions.status("one", { type: "offline", requestID: "net-1", message: "offline" })
    exit(first)

    jest.advanceTimersByTime(1_000)
    sessions.status("one", { type: "busy" })
    const second = item(test.calls, 1)
    spawn(second)
    jest.advanceTimersByTime(59)
    expect(stopped(second)).toBe(false)
    jest.advanceTimersByTime(1)
    expect(stopped(second)).toBe(true)
  })

  it("preserves the active budget across a connection suspension", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(0))
    const test = setup()
    const sessions = test.session(true, 100)

    sessions.status("one", { type: "busy" })
    const first = item(test.calls)
    spawn(first)
    jest.advanceTimersByTime(40)
    sessions.suspend()
    exit(first)

    jest.advanceTimersByTime(1_000)
    sessions.status("one", { type: "busy" })
    const second = item(test.calls, 1)
    spawn(second)
    jest.advanceTimersByTime(60)

    expect(stopped(second)).toBe(true)
  })

  it("keeps unlimited tasks inhibited across pause and resume", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(0))
    const test = setup()
    const sessions = test.session(true, 0)

    sessions.status("one", { type: "busy" })
    const first = item(test.calls)
    spawn(first)
    jest.advanceTimersByTime(100_000)
    expect(stopped(first)).toBe(false)

    sessions.pause("one", "question")
    exit(first)
    jest.advanceTimersByTime(100_000)
    sessions.resume("one", "question")
    const second = item(test.calls, 1)
    spawn(second)
    jest.advanceTimersByTime(100_000)

    expect(stopped(second)).toBe(false)
    expect(test.logs.some((message) => message.includes("Safety timeout"))).toBe(false)
  })

  it("expires concurrent task budgets independently", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(0))
    const test = setup()
    const sessions = test.session(true, 100)

    sessions.status("first", { type: "busy" }, "First")
    const call = item(test.calls)
    spawn(call)
    jest.advanceTimersByTime(40)
    sessions.status("second", { type: "busy" }, "Second")

    jest.advanceTimersByTime(60)
    expect(stopped(call)).toBe(false)
    expect(test.inhibitor.isActive()).toBe(true)

    jest.advanceTimersByTime(40)
    expect(stopped(call)).toBe(true)
    expect(test.logs.filter((message) => message.includes("Safety timeout"))).toHaveLength(2)
  })

  it("honors manual release until all current sessions stop", () => {
    const test = setup()
    const sessions = test.session()

    sessions.status("one", { type: "busy" })
    sessions.force()
    exit(item(test.calls))
    sessions.status("two", { type: "busy" })
    expect(test.calls).toHaveLength(1)

    sessions.status("one", { type: "idle" })
    sessions.status("two", { type: "idle" })
    sessions.status("three", { type: "busy" })
    expect(test.calls).toHaveLength(2)
  })
})

describe("sleep prevention settings", () => {
  it("keeps prevention disabled and uses a 30-minute safety timeout by default", async () => {
    const manifest = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
      contributes: { configuration: { properties: Record<string, { default?: unknown }> } }
    }
    const properties = manifest.contributes.configuration.properties

    expect(properties["kilo-code.new.preventSleepDuringTasks"]?.default).toBe(false)
    expect(properties["kilo-code.new.preventSleepDuringTasksTimeoutMinutes"]?.default).toBe(30)
  })
})

describe("SleepInhibitorService reconnect", () => {
  it("restores blocking suggestions from every known directory", async () => {
    const queries: string[] = []
    let state: ((state: "connected") => void) | undefined
    const connection = {
      onEvent: () => () => undefined,
      onStateChange: (handler: (state: "connected") => void) => {
        state = handler
        return () => undefined
      },
      getKnownDirectories: () => ["/workspace", "/worktree"],
      getClient: () =>
        backend(
          {
            status: async ({ directory }: { directory: string }) => ({
              data: directory === "/worktree" ? { one: { type: "busy" } } : {},
            }),
            get: async () => ({ data: { title: "Worktree task" } }),
          },
          {
            suggestions: {
              "/worktree": [{ id: "s1", sessionID: "one", text: "Choose", actions: [], blocking: true }],
            },
            queries,
          },
        ),
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    state?.("connected")
    await Bun.sleep(0)

    expect(queries).toEqual(["/workspace", "/worktree"])
    expect(blocked(service, "one")).toEqual(["suggestion:s1"])
    service.dispose()
  })

  it("restores pending input after a newer status event", async () => {
    const pending = Promise.withResolvers<{ data: { one: { type: "busy" } } }>()
    let event: ((event: SSEPayload, directory?: string) => void) | undefined
    let state: ((state: "connected") => void) | undefined
    const connection = {
      onEvent: (handler: (event: SSEPayload, directory?: string) => void) => {
        event = handler
        return () => undefined
      },
      onStateChange: (handler: (state: "connected") => void) => {
        state = handler
        return () => undefined
      },
      getKnownDirectories: () => ["/repo"],
      getClient: () =>
        backend(
          {
            status: () => pending.promise,
            get: async () => ({ data: { title: "Current task" } }),
          },
          { questions: [{ id: "q1", sessionID: "one", questions: [], blocking: true }] },
        ),
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    state?.("connected")
    event?.(
      { id: "busy", type: "session.status", properties: { sessionID: "one", status: { type: "busy" } } } as SSEPayload,
      "/repo",
    )
    pending.resolve({ data: { one: { type: "busy" } } })
    await Bun.sleep(0)

    expect(tracked(service)).toEqual(["one"])
    expect(blocked(service, "one")).toEqual(["question:q1"])
    service.dispose()
  })

  it("does not restore stale busy state after a newer idle event", async () => {
    const pending = Promise.withResolvers<{ data: { one: { type: "busy" } } }>()
    let event: ((event: SSEPayload, directory?: string) => void) | undefined
    let state: ((state: "connecting" | "connected" | "disconnected" | "error") => void) | undefined
    const connection = {
      onEvent: (handler: (event: SSEPayload, directory?: string) => void) => {
        event = handler
        return () => undefined
      },
      onStateChange: (handler: (state: "connecting" | "connected" | "disconnected" | "error") => void) => {
        state = handler
        return () => undefined
      },
      getKnownDirectories: () => ["/repo"],
      getClient: () =>
        backend({
          status: () => pending.promise,
          get: async () => ({ data: { title: "Current task" } }),
        }),
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    state?.("connected")
    event?.({
      id: "idle",
      type: "session.status",
      properties: { sessionID: "one", status: { type: "idle" } },
    } as SSEPayload)
    pending.resolve({ data: { one: { type: "busy" } } })
    await Bun.sleep(0)

    expect(tracked(service)).toEqual([])
    service.dispose()
  })

  it("removes tasks missed while the event stream was reconnecting", async () => {
    let event: ((event: SSEPayload, directory?: string) => void) | undefined
    let state: ((state: "connecting" | "connected" | "disconnected" | "error") => void) | undefined
    const connection = {
      onEvent: (handler: (event: SSEPayload, directory?: string) => void) => {
        event = handler
        return () => undefined
      },
      onStateChange: (handler: (state: "connecting" | "connected" | "disconnected" | "error") => void) => {
        state = handler
        return () => undefined
      },
      getKnownDirectories: () => ["/repo"],
      getClient: () =>
        backend({
          status: async () => ({ data: {} }),
          get: async () => ({ data: undefined }),
        }),
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    event?.({
      id: "busy",
      type: "session.status",
      properties: { sessionID: "one", status: { type: "busy" } },
    } as SSEPayload)
    expect(tracked(service)).toEqual(["one"])

    state?.("connected")
    await Bun.sleep(0)

    expect(tracked(service)).toEqual([])
    service.dispose()
  })

  it("preserves waits through transient errors and reconciles missed replies", async () => {
    let event: ((event: SSEPayload, directory?: string) => void) | undefined
    let state: ((state: "connecting" | "connected" | "disconnected" | "error") => void) | undefined
    let prompts: NonNullable<Parameters<typeof backend>[1]> = {
      questions: [{ id: "q1", sessionID: "one", questions: [], blocking: true }],
      p2: [{ id: "p2", sessionID: "one" }],
      suggestions: [{ id: "s1", sessionID: "one", text: "Choose", actions: [], blocking: true }],
    }
    const connection = {
      onEvent: (handler: (event: SSEPayload, directory?: string) => void) => {
        event = handler
        return () => undefined
      },
      onStateChange: (handler: typeof state) => {
        state = handler
        return () => undefined
      },
      getKnownDirectories: () => ["/repo"],
      getClient: () =>
        backend(
          {
            status: async () => ({ data: { one: { type: "busy" } } }),
            get: async () => ({ data: { title: "Current task" } }),
          },
          prompts,
        ),
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    event?.(
      { id: "busy", type: "session.status", properties: { sessionID: "one", status: { type: "busy" } } } as SSEPayload,
      "/repo",
    )
    event?.({
      id: "asked",
      type: "question.asked",
      properties: { id: "q1", sessionID: "one", questions: [], blocking: true },
    } as SSEPayload)
    state?.("error")
    state?.("connecting")
    expect(tracked(service)).toEqual(["one"])
    expect(blocked(service, "one")).toEqual(["question:q1"])

    state?.("connected")
    await Bun.sleep(0)
    expect(blocked(service, "one")).toEqual(["permission:p2", "question:q1", "suggestion:s1"])

    prompts = {}
    state?.("error")
    state?.("connected")
    await Bun.sleep(0)
    expect(blocked(service, "one")).toEqual([])
    service.dispose()
  })

  it("reconciles successful wait categories without clearing failed ones", async () => {
    let event: ((event: SSEPayload, directory?: string) => void) | undefined
    let state: ((state: "connected") => void) | undefined
    const connection = {
      onEvent: (handler: (event: SSEPayload, directory?: string) => void) => {
        event = handler
        return () => undefined
      },
      onStateChange: (handler: (state: "connected") => void) => {
        state = handler
        return () => undefined
      },
      getKnownDirectories: () => ["/repo"],
      getClient: () =>
        backend(
          {
            status: async () => ({ data: { one: { type: "busy" } } }),
            get: async () => ({ data: { title: "Current task" } }),
          },
          {
            questions: [{ id: "q1", sessionID: "one", questions: [], blocking: true }],
            fail: ["q2", "suggestion"],
          },
        ),
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    event?.(
      { id: "busy", type: "session.status", properties: { sessionID: "one", status: { type: "busy" } } } as SSEPayload,
      "/repo",
    )
    event?.({
      id: "question",
      type: "question.asked",
      properties: { id: "q1", sessionID: "one", questions: [], blocking: true },
    } as SSEPayload)
    event?.({
      id: "network",
      type: "session.network.asked",
      properties: { id: "n1", sessionID: "one", message: "offline" },
    } as SSEPayload)
    event?.({
      id: "suggestion",
      type: "suggestion.shown",
      properties: { id: "s1", sessionID: "one", text: "Choose", actions: [], blocking: true },
    } as SSEPayload)

    state?.("connected")
    await Bun.sleep(0)

    expect(blocked(service, "one")).toEqual(["question:q1", "suggestion:s1"])
    service.dispose()
  })

  it("resumes after a completed question tool even when no reply event arrives", () => {
    let event: ((event: SSEPayload, directory?: string) => void) | undefined
    const connection = {
      onEvent: (handler: (event: SSEPayload, directory?: string) => void) => {
        event = handler
        return () => undefined
      },
      onStateChange: () => () => undefined,
      getKnownDirectories: () => [],
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    event?.(
      { id: "busy", type: "session.status", properties: { sessionID: "one", status: { type: "busy" } } } as SSEPayload,
      "/repo",
    )
    event?.({
      id: "asked",
      type: "question.asked",
      properties: {
        id: "q1",
        sessionID: "one",
        questions: [],
        blocking: true,
        tool: { messageID: "message", callID: "call" },
      },
    } as SSEPayload)
    event?.({
      id: "asked-2",
      type: "question.asked",
      properties: {
        id: "q2",
        sessionID: "one",
        questions: [],
        blocking: true,
        tool: { messageID: "message-2", callID: "call-2" },
      },
    } as SSEPayload)
    expect(blocked(service, "one")).toEqual(["question:q1", "question:q2"])

    event?.({
      id: "part",
      type: "message.part.updated",
      properties: {
        sessionID: "one",
        part: {
          id: "part",
          sessionID: "one",
          messageID: "message",
          type: "tool",
          callID: "call",
          tool: "question",
          state: {
            status: "completed",
            input: {},
            output: "",
            title: "question",
            metadata: {},
            time: { start: 0, end: 1 },
          },
        },
        time: 1,
      },
    } as SSEPayload)

    expect(blocked(service, "one")).toEqual(["question:q2"])
    event?.({
      id: "reply-2",
      type: "question.replied",
      properties: { sessionID: "one", requestID: "q2", answers: [] },
    } as SSEPayload)
    expect(blocked(service, "one")).toEqual([])
    service.dispose()
  })

  it("reconciles successful directories without dropping tasks from failed ones", async () => {
    let event: ((event: SSEPayload, directory?: string) => void) | undefined
    let state: ((state: "connected") => void) | undefined
    const connection = {
      onEvent: (handler: (event: SSEPayload, directory?: string) => void) => {
        event = handler
        return () => undefined
      },
      onStateChange: (handler: (state: "connected") => void) => {
        state = handler
        return () => undefined
      },
      getKnownDirectories: () => ["/a", "/b"],
      getClient: () =>
        backend({
          status: async ({ directory }: { directory: string }) =>
            directory === "/a" ? { data: {} } : { error: "backend unavailable" },
          get: async () => ({ data: undefined }),
        }),
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    for (const [sessionID, directory] of [
      ["a", "/a"],
      ["b", "/b"],
    ] as const) {
      event?.(
        { id: sessionID, type: "session.status", properties: { sessionID, status: { type: "busy" } } } as SSEPayload,
        directory,
      )
    }

    state?.("connected")
    await Bun.sleep(0)

    expect(tracked(service)).toEqual(["b"])
    service.dispose()
  })

  it("restores offline status as a paused network wait", async () => {
    let event: ((event: SSEPayload, directory?: string) => void) | undefined
    let state: ((state: "connected") => void) | undefined
    const connection = {
      onEvent: (handler: (event: SSEPayload, directory?: string) => void) => {
        event = handler
        return () => undefined
      },
      onStateChange: (handler: (state: "connected") => void) => {
        state = handler
        return () => undefined
      },
      getKnownDirectories: () => ["/repo"],
      getClient: () =>
        backend(
          {
            status: async () => ({ data: { one: { type: "offline", requestID: "net", message: "offline" } } }),
            get: async () => ({ data: { title: "Current task" } }),
          },
          {
            network: [{ id: "net", sessionID: "one", message: "offline", restored: false, time: { created: 1 } }],
          },
        ),
    } as unknown as KiloConnectionService
    const service = new SleepInhibitorService(connection)

    state?.("connected")
    await Bun.sleep(0)
    expect(blocked(service, "one")).toEqual(["network:net"])
    expect(title(service, "one")).toBe("Current task")

    event?.({
      id: "restored",
      type: "session.network.restored",
      properties: { sessionID: "one", requestID: "net" },
    } as SSEPayload)
    event?.({
      id: "busy",
      type: "session.status",
      properties: { sessionID: "one", status: { type: "busy" } },
    } as SSEPayload)
    expect(blocked(service, "one")).toEqual([])
    service.dispose()
  })
})
