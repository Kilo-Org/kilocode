import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerCodeActions } from "../../src/services/code-actions/register-code-actions"

type Command = (...args: unknown[]) => unknown

type Api = typeof vscode & {
  commands: {
    registerCommand: (command: string, callback: Command) => { dispose(): void }
    executeCommand: (...args: unknown[]) => Promise<void>
  }
  languages: {
    getDiagnostics: () => Array<{ range: { intersection: () => unknown } }>
  }
  window: typeof vscode.window & { activeTextEditor?: unknown }
}

const api = vscode as Api
const original = {
  register: api.commands.registerCommand,
  execute: api.commands.executeCommand,
  editor: api.window.activeTextEditor,
  diagnostics: api.languages.getDiagnostics,
}

function setup(active = false, agentReady = true, last?: "sidebar" | "agent" | "tab") {
  const commands = new Map<string, Command>()
  const executed: unknown[][] = []
  const events: string[] = []
  const posts: unknown[] = []
  const waits: string[] = []
  const recipients: string[] = []
  const context = { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
  const provider = {
    postMessage: (msg: unknown) => {
      recipients.push("sidebar")
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("provider")
    },
  }
  const agent = {
    isActive: () => active,
    postMessage: (msg: unknown) => {
      recipients.push("agent")
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("agent")
      return agentReady
    },
  }
  const tab = {
    postMessage: (msg: unknown) => {
      recipients.push("tab")
      posts.push(msg)
    },
    waitForReady: async () => {
      waits.push("tab")
    },
  }
  const focused = { current: last }

  api.commands.registerCommand = (command, callback) => {
    commands.set(command, callback)
    return { dispose: () => undefined }
  }
  api.commands.executeCommand = async (...args) => {
    events.push("focus")
    executed.push(args)
  }
  api.languages.getDiagnostics = () => []
  api.window.activeTextEditor = {
    selection: {
      isEmpty: false,
      start: { line: 2 },
      end: { line: 4 },
    },
    document: {
      uri: vscode.Uri.file("/repo/src/file.ts"),
      getText: () => "const value = 1",
    },
  }

  const views = { sidebar: provider, agent, tab }
  registerCodeActions(context, provider as never, agent as never, undefined, () =>
    focused.current ? (views[focused.current] as never) : undefined,
  )

  return { commands, events, executed, posts, waits, recipients, focused }
}

afterEach(() => {
  api.commands.registerCommand = original.register
  api.commands.executeCommand = original.execute
  api.window.activeTextEditor = original.editor
  api.languages.getDiagnostics = original.diagnostics
})

function expectContextPost(post: unknown) {
  const value = post as { type: string; context: Record<string, unknown> }
  expect(value.type).toBe("appendChatContext")
  expect(value.context).toMatchObject({
    filePath: "src/file.ts",
    startLine: 3,
    endLine: 5,
    text: "const value = 1",
  })
  expect(typeof value.context.id).toBe("string")
  expect(value.context.id).not.toHaveLength(0)
}

describe("registerCodeActions", () => {
  it("keeps targeting Agent Manager after the code editor takes focus", async () => {
    const state = setup(false, true, "agent")

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.recipients).toEqual(["agent"])
    expect(state.executed).toEqual([])
    expect(state.waits).toEqual(["agent"])
    expectContextPost(state.posts.at(0))
  })

  it.each(["sidebar", "tab"] as const)("prefers the last focused %s over the active panel", async (last) => {
    const state = setup(true, true, last)

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.recipients).toEqual([last])
    expect(state.executed).toEqual(last === "sidebar" ? [["kilo-code.SidebarProvider.focus"]] : [])
    expectContextPost(state.posts.at(0))
  })

  it("uses the latest focused chat and falls back after it closes", async () => {
    const state = setup(false, true, "tab")
    state.focused.current = "agent"
    await state.commands.get("kilo-code.new.addToContext")?.()
    state.focused.current = undefined
    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.recipients).toEqual(["agent", "sidebar"])
  })

  it("does not reroute when the remembered Agent Manager closes while waiting", async () => {
    const state = setup(false, false, "agent")

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.waits).toEqual(["agent"])
    expect(state.recipients).toEqual([])
    expect(state.executed).toEqual([])
  })

  it("keeps focus-only commands on their existing route", async () => {
    const state = setup(false, true, "agent")

    await state.commands.get("kilo-code.new.focusChatInput")?.()
    await state.commands.get("kilo-code.new.toggleChatSearch")?.()

    expect(state.recipients).toEqual(["sidebar", "sidebar"])
    expect(state.waits).toEqual(["provider", "provider"])
  })

  it("reveals the sidebar before adding selected code to context", async () => {
    const state = setup()

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.events).toEqual(["focus", "wait", "post"])
    expect(state.executed).toEqual([["kilo-code.SidebarProvider.focus"]])
    expect(state.waits).toEqual(["provider"])
    expect(state.posts).toHaveLength(1)
    expectContextPost(state.posts[0])
  })

  it("adds selected code to the active Agent Manager without revealing the sidebar", async () => {
    const state = setup(true)

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.events).toEqual(["wait", "post"])
    expect(state.executed).toEqual([])
    expect(state.waits).toEqual(["agent"])
    expect(state.posts).toHaveLength(1)
    expectContextPost(state.posts[0])
  })

  it("does not post to the Agent Manager when its readiness wait is cancelled", async () => {
    const state = setup(true, false)

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.events).toEqual(["wait"])
    expect(state.posts).toEqual([])
  })

  it("toggles chat search on the active Agent Manager once it is ready", async () => {
    const state = setup(true)

    await state.commands.get("kilo-code.new.toggleChatSearch")?.()

    expect(state.events).toEqual(["wait", "post"])
    expect(state.posts).toEqual([{ type: "action", action: "focusSearch" }])
  })

  it("does not toggle chat search when Agent Manager readiness is cancelled", async () => {
    const state = setup(true, false)

    await state.commands.get("kilo-code.new.toggleChatSearch")?.()

    expect(state.events).toEqual(["wait"])
    expect(state.posts).toEqual([])
  })
})
