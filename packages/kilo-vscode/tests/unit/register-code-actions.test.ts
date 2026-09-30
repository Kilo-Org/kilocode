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

function setup(
  active = false,
  agentReady = true,
  lastFocused?: { postMessage: (msg: unknown) => void; waitForReady: () => Promise<unknown> },
) {
  const commands = new Map<string, Command>()
  const executed: unknown[][] = []
  const events: string[] = []
  const posts: unknown[] = []
  const waits: string[] = []
  const context = { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
  const provider = {
    postMessage: (msg: unknown) => {
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
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("agent")
      return agentReady
    },
  }

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

  registerCodeActions(context, provider as never, agent as never, undefined, () => lastFocused as never)

  return { commands, events, executed, posts, waits }
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

  it("adds selected code to the last focused chat instead of the sidebar", async () => {
    const posts: unknown[] = []
    const tab = {
      postMessage: (msg: unknown) => {
        posts.push(msg)
      },
      waitForReady: async () => undefined,
    }
    const state = setup(false, true, tab)

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(posts).toHaveLength(1)
    expectContextPost(posts[0])
    // The sidebar is neither revealed nor posted to.
    expect(state.executed).toEqual([])
    expect(state.posts).toEqual([])
  })

  it("keeps routing focus-only commands through the active surface", async () => {
    const posts: unknown[] = []
    const tab = {
      postMessage: (msg: unknown) => {
        posts.push(msg)
      },
      waitForReady: async () => undefined,
    }
    const state = setup(false, true, tab)

    await state.commands.get("kilo-code.new.focusChatInput")?.()

    expect(posts).toEqual([])
    expect(state.executed).toEqual([["kilo-code.SidebarProvider.focus"]])
    expect(state.posts).toEqual([{ type: "action", action: "focusInput" }])
  })
})
