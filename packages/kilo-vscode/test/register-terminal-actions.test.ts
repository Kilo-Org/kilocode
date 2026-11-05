import { afterEach, describe, expect, it } from "bun:test"
import { commands, env, window, type ExtensionContext } from "vscode"
import { registerTerminalActions } from "../src/services/code-actions/register-terminal-actions"
import { chatFocus, createChatTarget } from "../src/services/code-actions/target"

type Command = (...args: unknown[]) => unknown

type Clipboard = {
  readText: () => Promise<string>
  writeText: (value: string) => Promise<void>
}

type Api = {
  commands: {
    registerCommand: (id: string, callback: Command) => { dispose(): void }
    executeCommand: (...args: unknown[]) => Promise<void>
  }
  window: {
    showInformationMessage: (message: string) => Promise<unknown>
  }
  env: {
    clipboard?: Clipboard
  }
}

const api = { commands, window, env } as unknown as Api
const original = {
  register: api.commands.registerCommand,
  execute: api.commands.executeCommand,
  message: api.window.showInformationMessage,
  clipboard: api.env.clipboard,
}

const NO_CONTENT = "No terminal content available. Select text in the terminal first."

function dataUrlText(uri: string) {
  return Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8")
}

function setup(options: { agentActive?: boolean; agentReady?: boolean; terminal?: string } = {}) {
  const handlers = new Map<string, Command>()
  const executed: string[][] = []
  const posts: unknown[] = []
  const agentPosts: unknown[] = []
  const waits: string[] = []
  const messages: string[] = []
  const events: string[] = []
  let clipboard = "previous clipboard"
  const context = { subscriptions: [] as Array<{ dispose(): void }> } as unknown as ExtensionContext

  api.commands.registerCommand = (id, callback) => {
    handlers.set(id, callback)
    return { dispose: () => undefined }
  }
  api.commands.executeCommand = async (...args: unknown[]) => {
    events.push("focus")
    executed.push(args.map(String))
    if (args[0] === "workbench.action.terminal.copySelection") clipboard = options.terminal ?? ""
  }
  api.window.showInformationMessage = async (message) => {
    messages.push(message)
    return undefined
  }
  api.env.clipboard = {
    readText: async () => clipboard,
    writeText: async (value) => {
      clipboard = value
    },
  }

  const view = {
    post: (message: unknown) => {
      events.push("post")
      posts.push(message)
      return Promise.resolve(true)
    },
  }
  const agent = {
    isActive: () => options.agentActive ?? false,
    focusPanel: () => {
      events.push("reveal")
      waits.push("reveal")
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("agent")
      return options.agentReady ?? true
    },
    postMessage: (message: unknown) => {
      events.push("post")
      agentPosts.push(message)
    },
  }

  registerTerminalActions(context, createChatTarget({ view, agentManager: agent }))

  return { handlers, executed, posts, agentPosts, waits, messages, events, clipboard: () => clipboard }
}

afterEach(() => {
  chatFocus.closed("sidebar")
  chatFocus.closed("agentManager")
  api.commands.registerCommand = original.register
  api.commands.executeCommand = original.execute
  api.window.showInformationMessage = original.message
  api.env.clipboard = original.clipboard
})

describe("registerTerminalActions", () => {
  it("focuses the chat before adding terminal output to context", async () => {
    const state = setup()

    await state.handlers.get("kilo-code.v2.terminalAddToContext")?.({ selection: "bun test" })

    expect(state.events).toEqual(["focus", "post"])
    expect(state.executed).toEqual([["kilo-code.v2.chat.focus"]])
    expect(state.posts).toHaveLength(1)
    const post = state.posts[0] as { type: string; items: Array<Record<string, unknown>> }
    expect(post.type).toBe("appendContext")
    expect(post.items[0]).toMatchObject({
      kind: "terminal",
      name: "Terminal output",
      description: "Terminal output",
    })
    expect(dataUrlText(String(post.items[0]?.uri))).toBe("bun test")
  })

  it("adds terminal output to the active Agent Manager without revealing the sidebar", async () => {
    const state = setup({ agentActive: true })

    await state.handlers.get("kilo-code.v2.terminalAddToContext")?.({ selection: "bun test" })

    expect(state.events).toEqual(["reveal", "wait", "post"])
    expect(state.executed).toEqual([])
    expect(state.posts).toEqual([])
    expect(state.waits).toEqual(["reveal", "agent"])
    expect(state.agentPosts).toHaveLength(1)
    const post = state.agentPosts[0] as { type: string; items: Array<Record<string, unknown>> }
    expect(post.type).toBe("appendContext")
    expect(dataUrlText(String(post.items[0]?.uri))).toBe("bun test")
  })

  it("reads the whole terminal when no selection is given", async () => {
    const state = setup({ terminal: "npm install\nadded 1 package\nnpm install" })

    await state.handlers.get("kilo-code.v2.terminalAddToContext")?.(undefined)

    expect(state.executed).toEqual([
      ["workbench.action.terminal.selectAll"],
      ["workbench.action.terminal.copySelection"],
      ["workbench.action.terminal.clearSelection"],
      ["kilo-code.v2.chat.focus"],
    ])
    const post = state.posts[0] as { type: string; items: Array<Record<string, unknown>> }
    expect(post.type).toBe("appendContext")
    expect(dataUrlText(String(post.items[0]?.uri))).toBe("npm install\nadded 1 package")
    expect(state.clipboard()).toBe("previous clipboard")
  })

  it("keeps the clipboard when the terminal copy is empty", async () => {
    const state = setup({ terminal: "" })

    await state.handlers.get("kilo-code.v2.terminalAddToContext")?.(undefined)

    expect(state.messages).toEqual([NO_CONTENT])
    expect(state.posts).toEqual([])
    expect(state.agentPosts).toEqual([])
    expect(state.clipboard()).toBe("previous clipboard")
  })

  it("reports empty terminal content for fix and explain", async () => {
    const state = setup({ terminal: "" })

    await state.handlers.get("kilo-code.v2.terminalFixCommand")?.(undefined)
    await state.handlers.get("kilo-code.v2.terminalExplainCommand")?.(undefined)

    expect(state.messages).toEqual([NO_CONTENT, NO_CONTENT])
    expect(state.posts).toEqual([])
  })

  it("reads the previous command for fix without a selection", async () => {
    const state = setup({ terminal: "git statsu\nsome output\ngit statsu" })

    await state.handlers.get("kilo-code.v2.terminalFixCommand")?.(undefined)

    expect(state.executed).toEqual([
      ["workbench.action.terminal.selectToPreviousCommand"],
      ["workbench.action.terminal.copySelection"],
      ["workbench.action.terminal.clearSelection"],
      ["kilo-code.v2.chat.focus"],
    ])
    const post = state.posts[0] as { type: string; text: string }
    expect(post.type).toBe("startPrompt")
    expect(post.text).toContain("Fix this terminal command:")
    expect(post.text).toContain("git statsu")
  })

  it("reads the previous command for explain without a selection", async () => {
    const state = setup({ terminal: "git status\nsome output\ngit status" })

    await state.handlers.get("kilo-code.v2.terminalExplainCommand")?.(undefined)

    expect(state.executed).toEqual([
      ["workbench.action.terminal.selectToPreviousCommand"],
      ["workbench.action.terminal.copySelection"],
      ["workbench.action.terminal.clearSelection"],
      ["kilo-code.v2.chat.focus"],
    ])
    const post = state.posts[0] as { type: string; text: string }
    expect(post.type).toBe("startPrompt")
    expect(post.text).toContain("Explain this terminal command:")
    expect(post.text).toContain("git status")
  })
})
