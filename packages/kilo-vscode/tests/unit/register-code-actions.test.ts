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

function setup(active = false) {
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

  registerCodeActions(context, provider as never, agent as never)

  return { commands, events, executed, posts, waits }
}

afterEach(() => {
  api.commands.registerCommand = original.register
  api.commands.executeCommand = original.execute
  api.window.activeTextEditor = original.editor
  api.languages.getDiagnostics = original.diagnostics
})

describe("registerCodeActions", () => {
  it("reveals the sidebar before adding selected code to context", async () => {
    const state = setup()

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.events).toEqual(["focus", "wait", "post"])
    expect(state.executed).toEqual([["kilo-code.SidebarProvider.focus"]])
    expect(state.waits).toEqual(["provider"])
    expect(state.posts).toEqual([
      {
        type: "appendChatBoxMessage",
        text: "src/file.ts:3-5\n```\nconst value = 1\n```",
      },
    ])
  })

  it("adds selected code to the active Agent Manager without revealing the sidebar", async () => {
    const state = setup(true)

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.events).toEqual(["post"])
    expect(state.executed).toEqual([])
    expect(state.waits).toEqual([])
    expect(state.posts).toEqual([
      {
        type: "appendChatBoxMessage",
        text: "src/file.ts:3-5\n```\nconst value = 1\n```",
      },
    ])
  })
})
