/**
 * The permissioned extension host, as it runs *inside the child process*.
 *
 * This file is the only thing Kilo executes in that process before the extension. It:
 * - imports the approved entrypoint here, not in the main process;
 * - hands the extension a `kilo` capability object whose every privileged method is an IPC request
 *   the main process adjudicates and performs;
 * - forwards tool invocations and lifecycle-hook events in, and results back out.
 *
 * It deliberately does not try to remove `node:fs`, `fetch` or `Bun.$` from the extension's reach:
 * a JavaScript-level "sandbox" that can be walked around with one `import()` would be a lie. The
 * boundary is the process and the OS profile it was launched under; what this file provides is the
 * *mediated* path, so an extension that wants to act legitimately has one.
 */
import { ExtensionProtocol } from "./protocol"

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

const pending = new Map<number, Pending>()
let nextId = 1

function send(event: ExtensionProtocol.Event) {
  process.stdout.write(ExtensionProtocol.encode(event))
}

/** Ask the main process to perform a privileged operation, and wait for its verdict. */
function request(capability: ExtensionProtocol.Capability): Promise<unknown> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ kind: "capability", id, request: capability })
  })
}

/** The capability surface an extension sees. Everything privileged goes through the main process. */
const kilo = {
  readFile: (path: string) => request({ op: "fs.read", path }) as Promise<string>,
  writeFile: (path: string, data: string) => request({ op: "fs.write", path, data }) as Promise<void>,
  fetch: (url: string, init?: { method?: string; body?: string }) =>
    request({ op: "net.request", url, method: init?.method, body: init?.body }) as Promise<string>,
  spawn: (command: string) => request({ op: "process.spawn", command }) as Promise<string>,
}

interface LoadedTool {
  id: string
  description: string
  execute: (args: unknown, ctx: unknown) => unknown
}

const tools = new Map<string, LoadedTool>()
const hooks = new Map<string, (input: unknown, output: unknown) => unknown>()

function collect(mod: Record<string, unknown>, fallbackId: string) {
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== "object" || value === null) continue
    const candidate = value as { description?: unknown; execute?: unknown }
    if (typeof candidate.execute !== "function") continue
    const id = name === "default" ? fallbackId : `${fallbackId}_${name}`
    tools.set(id, {
      id,
      description: typeof candidate.description === "string" ? candidate.description : "",
      execute: candidate.execute as LoadedTool["execute"],
    })
  }
}

async function collectHooks(mod: Record<string, unknown>) {
  for (const value of Object.values(mod)) {
    const server = (value as { server?: unknown })?.server ?? value
    if (typeof server !== "function") continue
    try {
      // A plugin factory receives the capability object instead of the host SDK: it is the only
      // authority this process is willing to hand out.
      const registered = await (server as (input: unknown) => Promise<Record<string, unknown>>)({ kilo })
      if (typeof registered !== "object" || registered === null) continue
      for (const [name, fn] of Object.entries(registered)) {
        if (typeof fn === "function") hooks.set(name, fn as (input: unknown, output: unknown) => unknown)
      }
    } catch {
      // A plugin whose factory throws simply registers nothing.
    }
  }
}

async function handle(command: ExtensionProtocol.Command) {
  switch (command.kind) {
    case "load": {
      try {
        const mod = (await import(command.file)) as Record<string, unknown>
        const fallback = (command.file.split("/").pop() ?? "extension").replace(/\.[^.]+$/, "")
        if (command.type === "custom-tool") collect(mod, fallback)
        else await collectHooks(mod)
        send({
          kind: "loaded",
          id: command.id,
          ok: true,
          tools: [...tools.values()].map((item) => ({ id: item.id, description: item.description })),
          hooks: [...hooks.keys()],
        })
      } catch (error) {
        send({ kind: "failed", id: command.id, ok: false, error: String(error) })
      }
      return
    }
    case "invoke": {
      const tool = tools.get(command.tool)
      if (!tool) {
        send({ kind: "invoked", id: command.id, ok: false, error: `unknown tool ${command.tool}` })
        return
      }
      try {
        const result = await tool.execute(command.args, { kilo })
        const output = typeof result === "string" ? result : JSON.stringify(result ?? null)
        send({ kind: "invoked", id: command.id, ok: true, output })
      } catch (error) {
        send({ kind: "invoked", id: command.id, ok: false, error: String(error) })
      }
      return
    }
    case "hook": {
      const fn = hooks.get(command.name)
      if (!fn) {
        send({ kind: "hooked", id: command.id, ok: true, output: command.output })
        return
      }
      try {
        await fn(command.input, command.output)
        send({ kind: "hooked", id: command.id, ok: true, output: command.output })
      } catch (error) {
        send({ kind: "hooked", id: command.id, ok: false, error: String(error) })
      }
      return
    }
    case "capability-result": {
      const waiter = pending.get(command.id)
      if (!waiter) return
      pending.delete(command.id)
      if (command.ok) waiter.resolve(command.value)
      else waiter.reject(new Error(command.error ?? "refused by the security policy"))
      return
    }
    case "shutdown":
      process.exit(0)
  }
}

let buffer = ""
process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8")
  let index = buffer.indexOf("\n")
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    const command = ExtensionProtocol.decode<ExtensionProtocol.Command>(line)
    if (command) void handle(command)
    index = buffer.indexOf("\n")
  }
})
process.stdin.resume()
send({ kind: "ready" })
