import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { useSlashCommand } from "../../webview-ui/src/hooks/useSlashCommand"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

function context() {
  const posted: WebviewMessage[] = []
  const handlers = new Set<(message: ExtensionMessage) => void>()
  return {
    posted,
    emit: (message: ExtensionMessage) => {
      for (const handler of handlers) handler(message)
    },
    vscode: {
      postMessage: (message: WebviewMessage) => posted.push(message),
      onMessage: (handler: (message: ExtensionMessage) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    },
  }
}

describe("useSlashCommand", () => {
  it("keeps server-only command catalogs scoped to the selected cloud session", () => {
    const ctx = context()
    const [sid, setSid] = createSignal<string | undefined>("ses_a")
    const dispose: { fn?: () => void } = {}
    const slash = createRoot((root) => {
      dispose.fn = root
      return useSlashCommand(ctx.vscode, undefined, { sessionID: sid })
    })

    slash.onInput("/", 1)
    expect(ctx.posted).toEqual([{ type: "requestCommands", sessionID: "ses_a", requestID: 1 }])
    expect(slash.commands()).toEqual([])

    ctx.emit({
      type: "commandsLoaded",
      sessionID: "ses_a",
      requestID: 1,
      commands: [{ name: "init", description: "Initialize", hints: [] }],
    })
    expect(slash.commands()).toEqual([{ name: "init", description: "Initialize", hints: [] }])

    setSid("ses_b")
    slash.onInput("/", 1)
    expect(ctx.posted.at(-1)).toEqual({ type: "requestCommands", sessionID: "ses_b", requestID: 1 })
    expect(slash.commands()).toEqual([])

    ctx.emit({ type: "commandsLoaded", sessionID: "ses_a", requestID: 1, commands: [{ name: "late", hints: [] }] })
    expect(slash.commands()).toEqual([])
    ctx.emit({ type: "commandsLoaded", sessionID: "ses_b", requestID: 1, commands: [{ name: "review", hints: [] }] })
    expect(slash.commands()).toEqual([{ name: "review", hints: [] }])

    slash.close()
    slash.onInput("/", 1)
    expect(ctx.posted.at(-1)).toEqual({ type: "requestCommands", sessionID: "ses_b", requestID: 2 })
    expect(ctx.posted).toHaveLength(3)
    ctx.emit({ type: "commandsLoaded", sessionID: "ses_b", requestID: 1, commands: [{ name: "stale", hints: [] }] })
    expect(slash.commands()).toEqual([{ name: "review", hints: [] }])
    ctx.emit({ type: "commandsLoaded", sessionID: "ses_b", requestID: 2, commands: [{ name: "fresh", hints: [] }] })
    expect(slash.commands()).toEqual([{ name: "fresh", hints: [] }])

    dispose.fn?.()
  })

  it("resolves exact command names before hints and preserves arguments", () => {
    const ctx = context()
    const slash = createRoot(() => useSlashCommand(ctx.vscode))
    ctx.emit({
      type: "commandsLoaded",
      commands: [
        { name: "audit", hints: ["review", "check"] },
        { name: "review", hints: [] },
      ],
    })

    expect(slash.resolve("/review focus auth")).toEqual({
      command: { name: "review", hints: [] },
      arguments: "focus auth",
    })
    expect(slash.resolve("/check focus auth")).toEqual({
      command: { name: "audit", hints: ["review", "check"] },
      arguments: "focus auth",
    })
    expect(slash.resolve("/missing")).toBeUndefined()
  })

  it("preserves the unscoped mixed local command catalog", () => {
    const ctx = context()
    const dispose: { fn?: () => void } = {}
    const slash = createRoot((root) => {
      dispose.fn = root
      return useSlashCommand(ctx.vscode)
    })

    slash.onInput("/", 1)
    expect(ctx.posted).toEqual([{ type: "requestCommands" }])
    ctx.emit({ type: "commandsLoaded", sessionID: "ses_cloud", commands: [{ name: "cloud", hints: [] }] })
    expect(slash.commands().some((command) => command.name === "cloud")).toBe(false)

    ctx.emit({ type: "commandsLoaded", commands: [{ name: "review", hints: [] }] })
    expect(slash.commands().some((command) => command.name === "new" && Boolean(command.action))).toBe(true)
    expect(slash.commands().some((command) => command.name === "review" && !command.action)).toBe(true)

    dispose.fn?.()
  })
})
