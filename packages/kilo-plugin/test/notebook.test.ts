import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { broker, takeBroker } from "../src/notebook/broker"
import { register } from "../src/notebook"
import { makeTools } from "../src/notebook/tools"

const saved = { ...process.env }
const context = {
  sessionID: "ses_notebook",
  agent: "code",
  messageID: "msg_notebook",
  id: "call_notebook",
  progress: () => Effect.void,
} as never

afterEach(() => {
  process.env = { ...saved }
  delete process.env.KILO_NOTEBOOK_BROKER_URL
  delete process.env.KILO_NOTEBOOK_BROKER_TOKEN
})

function configure(url: string | undefined, token = "secret") {
  if (url === undefined) {
    delete process.env.KILO_NOTEBOOK_BROKER_URL
    delete process.env.KILO_NOTEBOOK_BROKER_TOKEN
    return
  }
  process.env.KILO_NOTEBOOK_BROKER_URL = url
  process.env.KILO_NOTEBOOK_BROKER_TOKEN = token
}

describe("notebook broker endpoint", () => {
  test("accepts the loopback origin the host serves", () => {
    configure("http://127.0.0.1:41234")
    expect(broker()).toEqual({ url: new URL("http://127.0.0.1:41234"), token: "secret" })
  })

  test("removes the capability from the process environment once it is read", () => {
    configure("http://127.0.0.1:41234")
    expect(takeBroker()).toEqual({ url: new URL("http://127.0.0.1:41234"), token: "secret" })
    expect(process.env.KILO_NOTEBOOK_BROKER_URL).toBeUndefined()
    expect(process.env.KILO_NOTEBOOK_BROKER_TOKEN).toBeUndefined()
    expect(broker()).toBeUndefined()
    expect(takeBroker()).toEqual({ url: new URL("http://127.0.0.1:41234"), token: "secret" })
  })

  test("is absent without both values", () => {
    configure(undefined)
    expect(broker()).toBeUndefined()
    configure("http://127.0.0.1:41234")
    delete process.env.KILO_NOTEBOOK_BROKER_TOKEN
    expect(broker()).toBeUndefined()
  })

  test.each([
    "http://localhost:41234",
    "https://127.0.0.1:41234",
    "http://127.0.0.1:41234/notebook",
    "http://127.0.0.1:41234?x=1",
    "http://user:pass@127.0.0.1:41234",
    "not a url",
  ])("rejects %s", (value) => {
    configure(value)
    expect(broker()).toBeUndefined()
  })
})

describe("notebook registration", () => {
  function host() {
    const added: Array<{ name: string; description: string; options?: { codemode?: boolean } }> = []
    const ctx = {
      location: { directory: "/repo" },
      permission: { assert: () => Effect.void },
      tool: {
        transform: (fn: (editor: { add: (tool: never) => void }) => void) =>
          Effect.sync(() => fn({ add: (tool) => added.push(tool) })),
      },
    }
    return { ctx, added }
  }

  test("registers nothing without a host endpoint", async () => {
    const { ctx, added } = host()
    await Effect.runPromise(Effect.scoped(register(ctx as never, undefined)))
    expect(added).toEqual([])
  })

  test("adds the three native tools only with a host endpoint", async () => {
    const { ctx, added } = host()
    await Effect.runPromise(
      Effect.scoped(register(ctx as never, { url: new URL("http://127.0.0.1:41234"), token: "secret" })),
    )
    expect(added.map((tool) => tool.name)).toEqual(["notebook_read", "notebook_edit", "notebook_execute"])
    for (const tool of added) {
      expect(tool.options?.codemode).toBe(false)
      expect(tool.description.split("\n")[0]!.length).toBeLessThanOrEqual(120)
    }
  })
})

describe("notebook tools", () => {
  let http: ReturnType<typeof Bun.serve>
  let received: { authorization?: string; body?: unknown } = {}
  let reply: unknown = {}

  function tools() {
    const asks: Array<{ action: string; resources: ReadonlyArray<string> }> = []
    http = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        received = { authorization: request.headers.get("authorization") ?? undefined, body: await request.json() }
        return Response.json(reply)
      },
    })
    const result = makeTools({
      endpoint: { url: new URL(http.url), token: "secret" },
      directory: "/repo",
      permission: {
        assert: (input) =>
          Effect.sync(() => {
            asks.push({ action: input.action, resources: input.resources })
          }),
      },
    })
    return { ...result, asks }
  }

  afterEach(() => {
    http?.stop(true)
    received = {}
    reply = {}
  })

  test("asks with the notebook permission and renders bounded read output", async () => {
    const { read, asks } = tools()
    reply = {
      result: {
        operation: "read",
        path: "book.ipynb",
        requestPath: "book.ipynb",
        revision: "content:read",
        cells: [{ index: 0, kind: "code", language: "python", source: "x".repeat(200_000) }],
      },
    }
    const result = await Effect.runPromise(read.execute!({ path: "book.ipynb", include_outputs: true }, context))

    expect(asks).toEqual([{ action: "notebook_read", resources: ["book.ipynb"] }])
    expect(received.authorization).toBe("Bearer secret")
    expect(received.body).toEqual({ operation: "read", directory: "/repo", path: "book.ipynb", includeOutputs: true })
    expect(result.output!.length).toBeLessThanOrEqual(20_000)
    const rendered = JSON.parse(result.output!)
    expect(rendered).toMatchObject({ truncated: true, omittedCharacters: expect.any(Number) })
    expect(rendered.preview).toContain('"revision"')
    expect(rendered.preview).not.toContain("requestPath")
    expect(result.metadata).toEqual({ path: "book.ipynb", revision: "content:read" })
  })

  test("creates a notebook without a revision or cell fields", async () => {
    const { edit, asks } = tools()
    reply = {
      result: {
        operation: "edit",
        path: "fresh.ipynb",
        requestPath: "fresh.ipynb",
        revision: "content:create",
        index: 0,
        action: "create",
      },
    }
    const result = await Effect.runPromise(edit.execute!({ path: "fresh.ipynb", action: "create" }, context))

    expect(asks).toEqual([{ action: "notebook_edit", resources: ["fresh.ipynb"] }])
    expect(received.body).toEqual({
      operation: "edit",
      directory: "/repo",
      path: "fresh.ipynb",
      index: 0,
      edit: { action: "create" },
    })
    expect(result.metadata).toEqual({ path: "fresh.ipynb", revision: "content:create", index: 0 })
  })

  test("replaces a cell with the expected revision and executes one cell", async () => {
    const { edit, execute, asks } = tools()
    reply = {
      result: {
        operation: "edit",
        path: "book.ipynb",
        requestPath: "book.ipynb",
        revision: "content:edit",
        index: 0,
        action: "replace",
      },
    }
    await Effect.runPromise(
      edit.execute!(
        {
          path: "book.ipynb",
          expected_revision: "content:read",
          index: 0,
          action: "replace",
          kind: "code",
          language: "python",
          source: "print(42)",
        },
        context,
      ),
    )
    expect(received.body).toEqual({
      operation: "edit",
      directory: "/repo",
      path: "book.ipynb",
      expectedRevision: "content:read",
      index: 0,
      edit: { action: "replace", kind: "code", language: "python", source: "print(42)" },
    })

    reply = {
      result: {
        operation: "execute",
        path: "book.ipynb",
        requestPath: "book.ipynb",
        revision: "content:execute",
        index: 0,
        status: "success",
        outputs: [{ mime: "text/plain", text: "42" }],
      },
    }
    const result = await Effect.runPromise(
      execute.execute!({ path: "book.ipynb", expected_revision: "content:edit", index: 0 }, context),
    )
    expect(asks.map((item) => item.action)).toEqual(["notebook_edit", "notebook_execute"])
    expect(received.body).toEqual({
      operation: "execute",
      directory: "/repo",
      path: "book.ipynb",
      expectedRevision: "content:edit",
      index: 0,
    })
    expect(result.metadata).toEqual({ path: "book.ipynb", revision: "content:execute", index: 0 })
  })

  test("rejects insert without kind and source before asking for permission", async () => {
    const { edit, asks } = tools()
    const error = await Effect.runPromise(
      Effect.flip(
        edit.execute!({ path: "book.ipynb", expected_revision: "content:read", index: 0, action: "insert" }, context),
      ),
    )
    expect(error.message).toContain('requires "kind", "source", "expected_revision", and "index"')
    expect(asks).toEqual([])
    expect(received.body).toBeUndefined()
  })

  test("maps a structured host failure to a tool error with its code", async () => {
    const { execute } = tools()
    reply = {
      error: {
        code: "stale_revision",
        message: "Notebook content changed",
        path: "book.ipynb",
        index: 0,
        currentRevision: "content:current",
      },
    }
    const error = await Effect.runPromise(
      Effect.flip(
        execute.execute!({ path: "book.ipynb", expected_revision: "content:read", index: 0 }, context),
      ),
    )
    expect(error.message).toContain("stale_revision")
    expect(error.message).toContain("Notebook content changed")
    expect(error.metadata).toEqual({
      code: "stale_revision",
      path: "book.ipynb",
      index: 0,
      currentRevision: "content:current",
    })
  })

  test("reports an unreachable host as disconnected", async () => {
    const { read } = tools()
    const endpoint = http.url
    http.stop(true)
    http = undefined as never
    const error = await Effect.runPromise(
      Effect.flip(
        makeTools({
          endpoint: { url: new URL(endpoint), token: "secret" },
          directory: "/repo",
          permission: { assert: () => Effect.void },
        }).read.execute!({ path: "book.ipynb", include_outputs: false }, context),
      ),
    )
    expect(error.message).toContain("could not be reached")
    expect(error.metadata).toEqual({ code: "disconnected" })
  })
})
