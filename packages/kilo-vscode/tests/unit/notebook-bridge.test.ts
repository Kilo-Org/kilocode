import { describe, expect, it, mock } from "bun:test"
import type { NotebookRequest } from "@kilocode/sdk/v2/client"
import * as vscode from "vscode"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import { NotebookBridge, type NotebookBridgeContext } from "../../src/services/notebook/bridge"
import { NotebookError } from "../../src/services/notebook/path"

const read: NotebookRequest = {
  id: "notebook-1",
  sessionID: "session-1",
  operation: "read",
  path: "book.ipynb",
  includeOutputs: true,
}

function deferred<T>() {
  const state: { resolve?: (value: T) => void; reject?: (error: Error) => void } = {}
  const promise = new Promise<T>((resolve, reject) => {
    state.resolve = resolve
    state.reject = reject
  })
  return { promise, resolve: state.resolve!, reject: state.reject! }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function harness(context: NotebookBridgeContext, dirs = ["/repo"]) {
  const replies: unknown[] = []
  const rejections: unknown[] = []
  const lists = new Map<string, NotebookRequest[]>()
  const state = { failReply: false }
  const handlers: {
    event?: (event: SSEPayload, directory?: string) => void
    state?: (state: "connecting" | "connected" | "disconnected" | "error") => void
  } = {}
  const client = {
    kilocode: {
      notebook: {
        list: async ({ directory }: { directory?: string }) => ({ data: lists.get(directory ?? "") ?? [] }),
        reply: async (input: unknown) => {
          replies.push(input)
          return state.failReply ? { error: "offline" } : { data: true }
        },
        reject: async (input: unknown) => {
          rejections.push(input)
          return { data: true }
        },
      },
    },
  }
  const connection = {
    onEvent: (listener: typeof handlers.event) => {
      handlers.event = listener
      return () => {
        handlers.event = undefined
      }
    },
    onStateChange: (listener: typeof handlers.state) => {
      handlers.state = listener
      return () => {
        handlers.state = undefined
      }
    },
    getClient: () => client,
    getKnownDirectories: () => dirs,
  }
  const create = mock(async () => context)
  const bridge = new NotebookBridge(connection as never, { create, canonical: async (directory) => directory })
  const request = (value: NotebookRequest = read, directory = "/repo") =>
    handlers.event?.(
      { id: `event-${value.id}`, type: "kilocode.notebook.requested", properties: value } as SSEPayload,
      directory,
    )
  const cancel = (id = read.id, directory = "/repo") =>
    handlers.event?.(
      {
        id: `cancel-${id}`,
        type: "kilocode.notebook.cancelled",
        properties: { requestID: id, sessionID: "session-1", reason: "cancelled" },
      } as SSEPayload,
      directory,
    )
  return { bridge, cancel, client, connection, create, handlers, lists, rejections, replies, request, state }
}

function context(overrides: Partial<NotebookBridgeContext["adapter"]> = {}) {
  const dispose = mock(() => undefined)
  const adapter = {
    read: mock(async () => ({
      operation: "read" as const,
      path: "book.ipynb",
      requestPath: "book.ipynb",
      revision: "content:2",
      cells: [],
    })),
    edit: mock(async () => ({
      operation: "edit" as const,
      path: "book.ipynb",
      requestPath: "book.ipynb",
      revision: "content:2",
      index: 0,
      action: "replace" as const,
    })),
    execute: mock(async () => ({
      operation: "execute" as const,
      path: "book.ipynb",
      requestPath: "book.ipynb",
      revision: "content:2",
      index: 0,
      status: "success" as const,
      outputs: [],
    })),
    ...overrides,
  }
  return { value: { adapter, dispose }, adapter, dispose }
}

describe("NotebookBridge", () => {
  it("deduplicates requests, retains their directory, and posts replies", async () => {
    const ctx = context()
    const test = harness(ctx.value)

    test.request()
    test.request()
    await flush()

    expect(test.create).toHaveBeenCalledTimes(1)
    expect(test.create).toHaveBeenCalledWith("/repo")
    expect(ctx.adapter.read).toHaveBeenCalledTimes(1)
    expect(ctx.adapter.read).toHaveBeenCalledWith({ path: "book.ipynb", directory: "/repo", includeOutputs: true })
    expect(test.replies).toEqual([
      {
        requestID: "notebook-1",
        directory: "/repo",
        result: { operation: "read", path: "book.ipynb", requestPath: "book.ipynb", revision: "content:2", cells: [] },
      },
    ])
    const bridge = test.bridge as unknown as { outcomes: Map<string, unknown>; settled: Set<string> }
    expect(bridge.outcomes.size).toBe(0)
    expect(bridge.settled.has("notebook-1")).toBe(true)

    test.bridge.dispose()
    await flush()
    expect(ctx.dispose).toHaveBeenCalledTimes(1)
    expect(test.handlers.event).toBeUndefined()
    expect(test.handlers.state).toBeUndefined()
  })

  it("rejects live requests outside known VS Code directories", async () => {
    const ctx = context()
    const test = harness(ctx.value, ["/repo"])

    test.request(read, "/outside")
    await flush()

    expect(test.create).not.toHaveBeenCalled()
    expect(ctx.adapter.read).not.toHaveBeenCalled()
    expect(test.rejections).toEqual([
      {
        requestID: "notebook-1",
        directory: "/outside",
        error: {
          code: "invalid_path",
          message: "Notebook request directory is not an active VS Code workspace",
        },
      },
    ])
    test.bridge.dispose()
  })

  it("retries context initialization after a transient failure", async () => {
    const ctx = context()
    const test = harness(ctx.value)
    test.create.mockImplementationOnce(async () => {
      throw new Error("unreadable ignore file")
    })

    test.request()
    await flush()
    expect(test.rejections).toHaveLength(1)

    test.request({ ...read, id: "notebook-2" })
    await flush()
    expect(test.create).toHaveBeenCalledTimes(2)
    expect(ctx.adapter.read).toHaveBeenCalledTimes(1)
    expect(test.replies).toHaveLength(1)
    test.bridge.dispose()
  })

  it("retries a failed reply without repeating the adapter operation", async () => {
    const ctx = context()
    const test = harness(ctx.value)
    test.state.failReply = true

    test.request()
    await flush()
    test.state.failReply = false
    test.request()
    await flush()

    expect(ctx.adapter.read).toHaveBeenCalledTimes(1)
    expect(test.replies).toHaveLength(2)
    test.bridge.dispose()
  })

  it("aborts cancelled execution without posting a late completion", async () => {
    const pending = deferred<never>()
    const signals: AbortSignal[] = []
    const execute = mock((request: { signal?: AbortSignal }) => {
      if (request.signal) {
        signals.push(request.signal)
        request.signal.addEventListener("abort", () => pending.reject(new NotebookError("cancelled", "cancelled")))
      }
      return pending.promise
    })
    const ctx = context({ execute: execute as never })
    const test = harness(ctx.value)
    test.request({
      id: "execute-1",
      sessionID: "session-1",
      operation: "execute",
      path: "book.ipynb",
      expectedRevision: "content:1",
      index: 0,
    })
    await flush()

    test.cancel("execute-1")
    await flush()

    expect(signals[0]?.aborted).toBe(true)
    expect(test.replies).toEqual([])
    expect(test.rejections).toEqual([])
    test.bridge.dispose()
  })

  it("bounds unexpected adapter failures for the protocol", async () => {
    const ctx = context({
      read: mock(async () => {
        throw new Error("x".repeat(20_000))
      }),
    })
    const test = harness(ctx.value)
    test.request()
    await flush()
    expect((test.rejections[0] as { error: { code: string; message: string } }).error).toMatchObject({
      code: "execution_failed",
      message: "x".repeat(10_000),
    })
    test.bridge.dispose()

    const empty = context({
      read: mock(async () => {
        throw new Error("")
      }),
    })
    const fallback = harness(empty.value)
    fallback.request()
    await flush()
    expect((fallback.rejections[0] as { error: { message: string } }).error.message).toBe(
      "Notebook operation failed without an error message",
    )
    fallback.bridge.dispose()
  })

  it("recovers pending requests for known directories and maps adapter failures", async () => {
    const ctx = context({
      read: mock(async () => {
        throw new NotebookError("stale_revision", "Notebook changed", {
          path: "book.ipynb",
          index: 0,
          currentRevision: "content:current",
        })
      }),
    })
    const test = harness(ctx.value, ["/root", "/worktree"])
    test.lists.set("/worktree", [read])

    test.handlers.state?.("connected")
    await flush()

    expect(test.rejections).toEqual([
      {
        requestID: "notebook-1",
        directory: "/worktree",
        error: {
          code: "stale_revision",
          message: "Notebook changed",
          path: "book.ipynb",
          index: 0,
          currentRevision: "content:current",
        },
      },
    ])
    test.bridge.dispose()
  })
})

describe("KiloConnectionService notebook directories", () => {
  it("tracks the workspace root, current request directory, and provider directories", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "workspaceFolders")
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      value: [{ uri: { fsPath: "/root" } }],
    })
    const service = new KiloConnectionService({} as vscode.ExtensionContext)
    const internals = service as unknown as { client: object; state: string }
    internals.client = {}
    internals.state = "connected"
    const unregister = service.registerDirectoryProvider(() => ["/worktree", "/root"])

    await service.getClientAsync("/current")

    expect(service.getKnownDirectories()).toEqual(["/root", "/current", "/worktree"])
    unregister()
    expect(service.getKnownDirectories()).toEqual(["/root", "/current"])
    service.dispose()
    if (descriptor) Object.defineProperty(vscode.workspace, "workspaceFolders", descriptor)
  })
})
