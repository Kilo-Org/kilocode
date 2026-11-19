import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { cloudTerminal } from "../webview-ui/agent-manager/cloud/terminal"

const target = { scope: "scope", providerID: "kilo-cloud", workspaceID: "work", sessionID: "root" } as const
const grant = { handle: "fixture-pty" }
const page = (state: string, frames: { binary: boolean; data: string }[] = []) =>
  Response.json({ output: { state, frames } })

function relay(read: () => Response, open = () => Promise.resolve(grant)) {
  const requests: string[] = []
  const inputs: unknown[] = []
  const release = Promise.withResolvers<void>()
  const client = OpenCode.make({
    baseUrl: "http://relay.invalid",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init)
        const name = new URL(req.url).pathname.split("/").at(-1)!
        requests.push(name)
        inputs.push((await req.json()).input)
        if (name === "terminalOpen") return Response.json({ output: await open() })
        if (name === "terminalClose") {
          release.resolve()
          return Response.json({ output: {} })
        }
        if (name !== "terminalRead") throw new Error(`Unexpected method ${name}`)
        return read()
      },
      { preconnect: fetch.preconnect },
    ),
  })
  return { client, requests, inputs, released: release.promise }
}

test("opens with Cloud dimensions and delivers its shell bytes without cursor metadata or an initial resize", async () => {
  const r = relay(() =>
    page("open", [
      { binary: false, data: '{"cursor":7}' },
      { binary: false, data: '{"user":"shell output"}' },
      { binary: true, data: btoa("ready$ ") },
    ]),
  )
  const errors: unknown[] = []
  const terminal = cloudTerminal(r.client, "/project", target, (...args) => errors.push(args))
  terminal.resize(1, 900)
  const socket = terminal.connect()
  const output: string[] = []
  socket.onmessage = ({ data }) => {
    output.push(typeof data === "string" ? data : new TextDecoder().decode(data))
    if (typeof data !== "string") socket.close()
  }
  await r.released
  expect(output).toEqual(['{"user":"shell output"}', "ready$ "])
  expect(r.requests).toEqual(["terminalOpen", "terminalRead", "terminalClose"])
  expect(r.inputs[0]).toEqual({ target, cols: 2, rows: 200 })
  expect(errors).toEqual([])
})

test.each(["exit", "drop", "refused"])(
  "reports whether the shell had opened before %s and releases its handle",
  async (event) => {
    const pages = event === "refused" ? [] : [page("open"), page("open")]
    const failure = { _tag: "RpcError", type: "HostedError", message: "Cloud terminal disconnected." }
    const end =
      event === "drop" ? Response.json(failure, { status: 400 }) : page("closed", [{ binary: false, data: "final" }])
    const r = relay(() => pages.shift() ?? end)
    const notices: unknown[] = []
    const events: unknown[] = []
    const socket = cloudTerminal(
      r.client,
      "/project",
      target,
      (...args) => notices.push(args),
      () => events.push("ready"),
    ).connect()
    socket.onopen = () => events.push("open")
    socket.onmessage = ({ data }) => events.push(data)
    socket.onerror = () => events.push("error")
    socket.onclose = ({ code }) => events.push(code)
    await r.released
    expect(socket.readyState).toBe(3)
    expect(notices).toEqual([
      [
        event === "drop" ? expect.objectContaining({ type: failure.type, message: failure.message }) : undefined,
        true,
        event !== "refused",
      ],
    ])
    expect(events).toEqual([
      ...(event === "refused" ? [] : ["open", "ready"]),
      ...(event === "drop" ? ["error", 1006] : ["final", 1000]),
    ])
    expect(r.inputs.at(-1)).toEqual({ target, ...grant })
  },
)

test("closing before the grant arrives releases the late handle without opening or reading", async () => {
  const pending = Promise.withResolvers<typeof grant>()
  const requested = Promise.withResolvers<void>()
  const r = relay(
    () => {
      throw new Error("unexpected read")
    },
    () => {
      requested.resolve()
      return pending.promise
    },
  )
  const notices: unknown[] = []
  const socket = cloudTerminal(
    r.client,
    "/project",
    target,
    (...args) => notices.push(args),
    () => notices.push("ready"),
  ).connect()
  await requested.promise
  socket.close()
  pending.resolve(grant)
  await r.released
  expect(r.requests).toEqual(["terminalOpen", "terminalClose"])
  expect(r.inputs[1]).toEqual({ target, ...grant })
  expect(notices).toEqual([])
  expect(socket.readyState).toBe(3)
})
