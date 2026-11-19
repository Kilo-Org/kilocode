import type { KiloAccount } from "@kilocode/gateway-core"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { HostedError } from "./error"
import { json } from "./transport"

const Created = Schema.Struct({ ptyId: Schema.String, wsUrl: Schema.String })
const Envelope = Schema.Struct({ result: Schema.Struct({ data: Schema.Unknown }) })
const Precondition = Schema.Struct({ error: Schema.Struct({ message: Schema.String }) })
const sleeping = "The sandbox is sleeping. Send a message to resume."
class UnpreparedRoute extends HostedError {}
type Target = KiloHostedRpc.Target
type Frame = { binary: boolean; data: string }
type Pty = {
  control: string
  ptyID: string
  target: Target
  socket: WebSocket
  output: Frame[]
  size: number
  closed: boolean
  reportedOpen: boolean
  readers: Set<() => void>
  expiry: ReturnType<typeof setTimeout>
}

function wake(item: Pty) {
  for (const reader of item.readers) reader()
}

export function createTerminals(
  account: KiloAccount.Info,
  origins: { issuer: string; worker: string },
  authorize: (target: Target, signal: AbortSignal) => Promise<string>,
  life: AbortSignal,
  readySibling?: (target: Target, signal: AbortSignal) => Promise<string | undefined>,
) {
  const terminals = new Map<string, Pty>()
  let opening = 0
  async function call(
    method: "createTerminal" | "closeTerminal" | "resizeTerminal",
    input: object,
    signal: AbortSignal,
  ) {
    const org = account.organizationID
    const prefix = org ? "organizations.cloudAgentNext" : "cloudAgentNext"
    const response = await fetch(`${origins.issuer}/api/trpc/${prefix}.${method}`, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(org ? { ...input, organizationId: org } : input),
    })
    if (!response.ok) {
      if (response.status === 412) {
        const reason = await json(response, 64 * 1024).catch(() => undefined)
        // A preparing route also returns 412. Only suggest resuming if the worker confirmed sleep.
        if (Schema.is(Precondition)(reason) && reason.error.message === sleeping) throw new HostedError(sleeping)
        throw new UnpreparedRoute("The Cloud terminal will be available when the workspace is running and ready.")
      }
      await response.body?.cancel()
      throw new HostedError(`Cloud terminal unavailable (HTTP ${response.status}).`)
    }
    const body = await json(response, 64 * 1024)
    if (!Schema.is(Envelope)(body)) throw new HostedError("Invalid terminal response.")
    return body.result.data
  }
  function close(id: string) {
    const item = terminals.get(id)
    if (!item) return
    terminals.delete(id)
    clearTimeout(item.expiry)
    item.closed = true
    wake(item)
    item.socket.close()
    void release(item.control, item.ptyID)
  }
  const release = (control: string, ptyID: string) =>
    call("closeTerminal", { cloudAgentSessionId: control, ptyId: ptyID }, AbortSignal.timeout(10_000)).catch(() => {})
  life.addEventListener(
    "abort",
    () => {
      for (const key of terminals.keys()) close(key)
    },
    { once: true },
  )
  function get(input: { target: Target; handle: string }) {
    const item = terminals.get(input.handle)
    if (
      !item ||
      item.target.scope !== input.target.scope ||
      item.target.workspaceID !== input.target.workspaceID ||
      item.target.sessionID !== input.target.sessionID
    )
      throw new HostedError("Cloud terminal is closed.")
    item.expiry.refresh()
    return item
  }
  return {
    async open(input: { target: Target; cols: number; rows: number }, signal: AbortSignal) {
      if (terminals.size + opening >= 8) throw new HostedError("Too many open Cloud terminals.")
      opening++
      try {
        const create = async (control: string) => ({
          control,
          result: await call(
            "createTerminal",
            { cloudAgentSessionId: control, cols: input.cols, rows: input.rows },
            signal,
          ),
        })
        const preferred = await authorize(input.target, signal)
        const { control, result } = await create(preferred).catch(async (error) => {
          if (!(error instanceof UnpreparedRoute) || !readySibling) throw error
          const sibling = await readySibling(input.target, signal)
          if (!sibling) throw error
          return create(sibling)
        })
        if (!Schema.is(Created)(result)) throw new HostedError("Invalid Cloud terminal grant.")
        try {
          signal.throwIfAborted()
          life.throwIfAborted()
          const url = new URL(result.wsUrl, origins.worker)
          if (
            url.origin !== origins.worker ||
            url.pathname !== "/terminal" ||
            url.searchParams.get("ptyId") !== result.ptyId ||
            url.searchParams.get("cloudAgentSessionId") !== control ||
            !url.searchParams.get("ticket")
          )
            throw new HostedError("Invalid Cloud terminal grant.")
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
          const handle = crypto.randomUUID()
          const socket = new WebSocket(url)
          socket.binaryType = "arraybuffer"
          const item: Pty = {
            control,
            ptyID: result.ptyId,
            target: input.target,
            socket,
            closed: false,
            reportedOpen: false,
            readers: new Set(),
            output: [],
            size: 0,
            expiry: setTimeout(() => close(handle), 90_000),
          }
          terminals.set(handle, item)
          socket.onmessage = (event) => {
            const binary = typeof event.data !== "string"
            const data = binary ? Buffer.from(event.data as ArrayBuffer).toString("base64") : (event.data as string)
            item.size += Buffer.byteLength(data)
            if (item.size > 1024 * 1024) {
              close(handle)
              return
            }
            item.output.push({ binary, data })
            wake(item)
          }
          socket.onopen = () => wake(item)
          socket.onclose = socket.onerror = () => {
            item.closed = true
            wake(item)
          }
          return { handle }
        } catch (error) {
          await release(control, result.ptyId)
          throw error
        }
      } finally {
        opening--
      }
    },
    async read(input: { target: Target; handle: string }, signal: AbortSignal) {
      signal.throwIfAborted()
      const item = get(input)
      // The handshake can finish before the first read; publish it once, even on a quiet shell.
      const newlyOpen = !item.reportedOpen && item.socket.readyState === WebSocket.OPEN
      if (!item.closed && !item.output.length && !newlyOpen) {
        await new Promise<void>((resolve) => {
          const end = () => {
            clearTimeout(timer)
            signal.removeEventListener("abort", end)
            item.readers.delete(end)
            resolve()
          }
          const timer = setTimeout(end, 15_000)
          item.readers.add(end)
          signal.addEventListener("abort", end, { once: true })
        })
        signal.throwIfAborted()
      }
      item.size = 0
      item.reportedOpen = item.socket.readyState === WebSocket.OPEN
      return {
        frames: item.output.splice(0),
        state: item.closed ? ("closed" as const) : item.reportedOpen ? ("open" as const) : ("connecting" as const),
      }
    },
    write(input: { target: Target; handle: string; data: string }) {
      const item = get(input)
      if (item.socket.readyState !== WebSocket.OPEN) throw new HostedError("Cloud terminal disconnected.")
      item.socket.send(input.data)
      return {}
    },
    async resize(input: { target: Target; handle: string; cols: number; rows: number }, signal: AbortSignal) {
      const item = get(input)
      await call(
        "resizeTerminal",
        { cloudAgentSessionId: item.control, ptyId: item.ptyID, cols: input.cols, rows: input.rows },
        signal,
      )
      return {}
    },
    close(input: { target: Target; handle: string }) {
      get(input)
      close(input.handle)
      return {}
    },
  }
}
