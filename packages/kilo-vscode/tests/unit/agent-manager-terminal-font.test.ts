import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { createRoot } from "solid-js"
import { affectsTerminalFont, resolveTerminalFont } from "../../src/agent-manager/terminal-font"
import { TerminalRouter } from "../../src/agent-manager/terminal-routing"
import type { AgentManagerOutMessage, TerminalFont } from "../../src/agent-manager/types"
import { createTerminalMessageHandler, createTerminalState } from "../../webview-ui/agent-manager/terminal/state"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages/extension-messages"

const font: TerminalFont = {
  fontFamily: "MesloLGS NF",
  fontSize: 18,
}

describe("Agent Manager terminal font", () => {
  it("resolves terminal settings without inheriting the editor size", () => {
    expect(resolveTerminalFont(undefined, undefined, undefined)).toEqual({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: process.platform === "darwin" ? 12 : 14,
    })
    expect(resolveTerminalFont("MesloLGS NF", 16, "Menlo")).toEqual({
      fontFamily: "MesloLGS NF",
      fontSize: 16,
    })
    expect(resolveTerminalFont(undefined, 16, "Menlo")).toEqual({
      fontFamily: "Menlo",
      fontSize: 16,
    })
  })

  it("watches only settings that affect the terminal family or size", () => {
    const event = (key: string) =>
      ({
        affectsConfiguration: (target: string) => target === key,
      }) as Parameters<typeof affectsTerminalFont>[0]

    expect(affectsTerminalFont(event("terminal.integrated.fontFamily"))).toBe(true)
    expect(affectsTerminalFont(event("terminal.integrated.fontSize"))).toBe(true)
    expect(affectsTerminalFont(event("editor.fontFamily"))).toBe(true)
    expect(affectsTerminalFont(event("editor.fontSize"))).toBe(false)
    expect(affectsTerminalFont(event("terminal.integrated.letterSpacing"))).toBe(false)
  })

  it("includes the current font when creating a terminal", async () => {
    const client = {
      pty: {
        create: async () => ({ data: { id: "pty-1", title: "Terminal 1" } }),
        remove: async () => ({ data: true }),
        update: async () => ({ data: true }),
      },
    } as unknown as KiloClient
    const message = new Promise<AgentManagerOutMessage>((resolve) => {
      const router = new TerminalRouter({
        getClient: () => client,
        getServerConfig: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
        getRoot: () => "/workspace",
        getWorktreePath: () => undefined,
        log: () => undefined,
        post: resolve,
        getTerminalFont: () => font,
      })

      expect(router.handle({ type: "agentManager.terminal.create", worktreeId: null })).toBe(true)
    })

    const created = await message
    expect(created.type).toBe("agentManager.terminal.created")
    if (created.type !== "agentManager.terminal.created") return
    expect(created.font).toEqual(font)
    expect(created.worktreeId).toBeNull()
    expect(created.wsUrl).toContain("/pty/pty-1/connect")
  })

  it("keeps the created font in terminal state", () => {
    createRoot((dispose) => {
      const state = createTerminalState(() => LOCAL)
      const activated: string[] = []
      const handler = createTerminalMessageHandler({
        state,
        activate: (id) => activated.push(id),
        saveTabMemory: () => undefined,
        setSelection: () => undefined,
        showError: () => undefined,
      })
      const message = {
        type: "agentManager.terminal.created",
        worktreeId: null,
        terminalId: "terminal-1",
        title: "Terminal 1",
        wsUrl: "ws://127.0.0.1/pty/pty-1/connect",
        font,
      } satisfies ExtensionMessage

      expect(handler(message)).toBe(true)
      expect(state.forSelection(LOCAL)[0]?.font).toEqual(font)
      expect(activated).toEqual(["terminal-1"])
      dispose()
    })
  })
})
