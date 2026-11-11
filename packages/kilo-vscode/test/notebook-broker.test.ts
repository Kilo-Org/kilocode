import { afterEach, describe, expect, mock, test } from "bun:test"
import { NotebookBroker, type NotebookBrokerContext } from "../src/services/notebook/broker"
import { NotebookError } from "../src/services/notebook/path"

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

function context(overrides: Partial<NotebookBrokerContext["adapter"]> = {}) {
  const dispose = mock(() => undefined)
  const refresh = mock(async () => undefined)
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
  return { value: { adapter, refresh, dispose }, adapter, refresh, dispose }
}

function harness(value: NotebookBrokerContext, dirs = ["/repo"]) {
  const create = mock(async () => value)
  const broker = new NotebookBroker({
    directories: () => dirs,
    create,
    canonical: async (directory) => directory,
  })
  return { broker, create }
}

async function call(broker: NotebookBroker, body: unknown, token?: string, init: RequestInit = {}) {
  const env = await broker.env()
  const response = await fetch(`${env.KILO_NOTEBOOK_BROKER_URL}/notebook/request`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token ?? env.KILO_NOTEBOOK_BROKER_TOKEN}`,
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  })
  return { response, env, body: (await response.json().catch(() => undefined)) as any }
}

const read = { operation: "read", directory: "/repo", path: "book.ipynb", includeOutputs: false } as const

describe("NotebookBroker", () => {
  let broker: NotebookBroker | undefined

  afterEach(async () => {
    await broker?.dispose()
    broker = undefined
  })

  test("serves the endpoint once with a per-run token", async () => {
    const ctx = context()
    const test = harness(ctx.value)
    broker = test.broker
    const first = await broker.env()
    const second = await broker.env()
    expect(first).toEqual(second)
    expect(first.KILO_NOTEBOOK_BROKER_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(first.KILO_NOTEBOOK_BROKER_TOKEN?.length).toBeGreaterThan(20)
  })

  test("rejects an unauthorized or malformed call", async () => {
    const ctx = context()
    const test = harness(ctx.value)
    broker = test.broker
    const unauthorized = await call(broker, read, "wrong")
    expect(unauthorized.response.status).toBe(401)
    const invalid = await call(broker, "{")
    expect(invalid.response.status).toBe(400)
    const missing = await call(broker, { operation: "read", directory: "/repo" })
    expect(missing.response.status).toBe(400)
    expect(test.create).not.toHaveBeenCalled()
  })

  test("rejects a directory outside the VS Code workspace", async () => {
    const ctx = context()
    const test = harness(ctx.value)
    broker = test.broker
    const result = await call(broker, { ...read, directory: "/outside" })
    expect(result.body).toEqual({
      error: {
        code: "invalid_path",
        message: "Notebook request directory is not an active VS Code workspace",
      },
    })
    expect(test.create).not.toHaveBeenCalled()
    expect(ctx.adapter.read).not.toHaveBeenCalled()
  })

  test("refreshes the ignore rules and dispatches read and edit", async () => {
    const ctx = context()
    const test = harness(ctx.value)
    broker = test.broker

    const readResult = await call(broker, read)
    expect(readResult.body).toEqual({
      result: { operation: "read", path: "book.ipynb", requestPath: "book.ipynb", revision: "content:2", cells: [] },
    })
    expect(test.create).toHaveBeenCalledWith("/repo")
    expect(ctx.refresh).toHaveBeenCalledTimes(1)
    expect(ctx.adapter.read).toHaveBeenCalledWith({ path: "book.ipynb", directory: "/repo", includeOutputs: false })

    const editResult = await call(broker, {
      operation: "edit",
      directory: "/repo",
      path: "book.ipynb",
      expectedRevision: "content:2",
      index: 0,
      edit: { action: "replace", kind: "code", source: "print(2)" },
    })
    expect(editResult.body.result.operation).toBe("edit")
    expect(ctx.adapter.edit).toHaveBeenCalledWith({
      path: "book.ipynb",
      directory: "/repo",
      expectedRevision: "content:2",
      index: 0,
      edit: { action: "replace", kind: "code", source: "print(2)" },
    })
  })

  test("maps a notebook error and bounds an unexpected one", async () => {
    const stale = context({
      execute: mock(async () => {
        throw new NotebookError("stale_revision", "Notebook changed", {
          path: "book.ipynb",
          index: 0,
          currentRevision: "content:current",
        })
      }),
    })
    const test = harness(stale.value)
    broker = test.broker
    const result = await call(broker, {
      operation: "execute",
      directory: "/repo",
      path: "book.ipynb",
      expectedRevision: "content:1",
      index: 0,
    })
    expect(result.body).toEqual({
      error: {
        code: "stale_revision",
        message: "Notebook changed",
        path: "book.ipynb",
        index: 0,
        currentRevision: "content:current",
      },
    })
    await broker.dispose()
    broker = undefined

    const failed = context({
      read: mock(async () => {
        throw new Error("x".repeat(20_000))
      }),
    })
    const second = harness(failed.value)
    broker = second.broker
    const bounded = await call(broker, read)
    expect(bounded.body.error.code).toBe("execution_failed")
    expect(bounded.body.error.message).toHaveLength(10_000)
  })

  test("keeps an already-existing create failure distinct", async () => {
    const ctx = context({
      edit: mock(async () => {
        throw new NotebookError("already_exists", "Notebook exists", { path: "book.ipynb" })
      }),
    })
    const test = harness(ctx.value)
    broker = test.broker
    const result = await call(broker, {
      operation: "edit",
      directory: "/repo",
      path: "book.ipynb",
      index: 0,
      edit: { action: "create" },
    })
    expect(result.body.error).toMatchObject({ code: "already_exists", path: "book.ipynb" })
  })

  test("aborts a running cell when the caller disconnects", async () => {
    const started = deferred<void>()
    let signal: AbortSignal | undefined
    const ctx = context({
      execute: mock((request: { signal?: AbortSignal }) => {
        signal = request.signal
        started.resolve()
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(new NotebookError("cancelled", "cancelled")))
        })
      }) as never,
    })
    const test = harness(ctx.value)
    broker = test.broker
    const controller = new AbortController()
    const env = await broker.env()
    const pending = fetch(`${env.KILO_NOTEBOOK_BROKER_URL}/notebook/request`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.KILO_NOTEBOOK_BROKER_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        operation: "execute",
        directory: "/repo",
        path: "book.ipynb",
        expectedRevision: "content:1",
        index: 0,
      }),
      signal: controller.signal,
    }).catch(() => undefined)

    await started.promise
    controller.abort()
    await pending
    await flush()
    expect(signal?.aborted).toBe(true)
  })

  test("aborts running work and disposes contexts when the host closes", async () => {
    const started = deferred<void>()
    let signal: AbortSignal | undefined
    const ctx = context({
      execute: mock((request: { signal?: AbortSignal }) => {
        signal = request.signal
        started.resolve()
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(new NotebookError("cancelled", "cancelled")))
        })
      }) as never,
    })
    const test = harness(ctx.value)
    broker = test.broker
    const env = await broker.env()
    void fetch(`${env.KILO_NOTEBOOK_BROKER_URL}/notebook/request`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.KILO_NOTEBOOK_BROKER_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        operation: "execute",
        directory: "/repo",
        path: "book.ipynb",
        expectedRevision: "content:1",
        index: 0,
      }),
    }).catch(() => undefined)

    await started.promise
    await broker.dispose()
    broker = undefined
    expect(signal?.aborted).toBe(true)
    expect(ctx.dispose).toHaveBeenCalledTimes(1)
    await expect(fetch(`${env.KILO_NOTEBOOK_BROKER_URL}/notebook/request`)).rejects.toBeDefined()
  })
})
