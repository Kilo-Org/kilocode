import type { RpcCallOptions, RpcClient } from "@opencode/client/promise/api"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { MEMORY_USAGE, parseMemoryCommand, type ParsedMemoryCommand } from "@kilocode/kilo-memory/commands"
import { errorMessage } from "../util/error"

export { MEMORY_USAGE }
export type MemoryCommand = ParsedMemoryCommand

export type MemoryRpc = Omit<RpcClient<typeof KiloMemoryRpc.Definition>, "events">

type Toast = {
  show(input: { message: string; variant: "error" | "info" | "success" }): void
}

/** Shared by the TUI memory command, dialog, and sidebar: routes an RPC call to the memory of a directory. */
export function route(input: { directory: string }): RpcCallOptions {
  return { location: { directory: input.directory } }
}

function tokens(count: number) {
  return `${count.toLocaleString()} memory ${count === 1 ? "token" : "tokens"}`
}

function changeCount(count: number) {
  return `${count} ${count === 1 ? "change" : "changes"}`
}

function auto(input: boolean) {
  return `Memory auto-save ${input ? "on" : "off"}`
}

export function parseMemoryInput(input: string): MemoryCommand | undefined {
  return parseMemoryCommand(input)
}

export async function runMemoryCommand(input: {
  text: string
  rpc: MemoryRpc
  directory: string
  sessionID?: string
  toast: Toast
  inspect?(root: string): void | Promise<void>
  show(): void
  status(): void
  usage(message?: string): void
}) {
  const parsed = parseMemoryInput(input.text)
  if (!parsed) return false
  const options = route(input)

  try {
    if (parsed.kind === "help") {
      input.usage()
      return true
    }
    if (parsed.kind === "show") {
      input.show()
      return true
    }
    if (parsed.kind === "usage") {
      input.usage(parsed.reason)
      return true
    }
    const name = "Memory"
    if (parsed.operation === "enable") {
      await input.rpc.enable({}, options)
      input.toast.show({
        variant: "success",
        message: `${name} enabled`,
      })
      return true
    }
    if (parsed.operation === "status") {
      input.status()
      return true
    }
    if (parsed.operation === "inspect") {
      const status = await input.rpc.status({}, options)
      if (!status.state.enabled) throw new Error("Memory is disabled. Run /memory on first.")
      if (!input.inspect) throw new Error("Memory folder inspection is unavailable")
      input.toast.show({ variant: "info", message: `Memory folder: ${status.root}` })
      await input.inspect(status.root)
      return true
    }
    if (parsed.operation === "auto") {
      const result = await input.rpc.configure({ autoConsolidate: parsed.mode === "on" }, options)
      input.toast.show({ variant: "info", message: auto(result.state.autoConsolidate) })
      return true
    }
    if (parsed.operation === "disable") {
      await input.rpc.disable({}, options)
      input.toast.show({ variant: "info", message: `${name} disabled` })
      return true
    }
    if (parsed.operation === "rebuild") {
      const result = await input.rpc.rebuild({}, options)
      input.toast.show({ variant: "success", message: `${name} rebuilt (${tokens(result.index.tokens)})` })
      return true
    }
    if (parsed.operation === "purge") {
      await input.rpc.purge({ confirm: true }, options)
      input.toast.show({ variant: "success", message: `${name} purged` })
      return true
    }
    // Wording mirrors the server memory event messages so chat-intent and command saves read the same.
    if (parsed.operation === "remember") {
      const result = await input.rpc.remember(
        {
          ...(input.sessionID ? { sessionID: input.sessionID } : {}),
          text: parsed.text,
        },
        options,
      )
      input.toast.show({ variant: "success", message: `Memory saved · ${changeCount(result.operationCount)}` })
      return true
    }
    if (parsed.operation === "correct") {
      const result = await input.rpc.correct(
        {
          ...(input.sessionID ? { sessionID: input.sessionID } : {}),
          text: parsed.text,
        },
        options,
      )
      input.toast.show({ variant: "success", message: `Correction saved · ${changeCount(result.operationCount)}` })
      return true
    }

    if (parsed.operation === "forget") {
      const result = await input.rpc.forget(
        {
          ...(input.sessionID ? { sessionID: input.sessionID } : {}),
          query: parsed.query,
        },
        options,
      )
      input.toast.show({ variant: "success", message: `Memory updated · ${result.removed.toLocaleString()} removed` })
    }
    return true
  } catch (error) {
    input.toast.show({ variant: "error", message: `Memory command failed: ${errorMessage(error)}` })
    return true
  }
}
