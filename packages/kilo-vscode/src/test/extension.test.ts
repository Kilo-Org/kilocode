import * as assert from "node:assert/strict"
import * as vscode from "vscode"

interface Target {
  postMessage: (message: unknown) => void
}

interface AgentManager extends Target {
  isActive: () => boolean
}

interface Api {
  sidebar: Target
  agentManager: AgentManager
  activeTab: () => Target | undefined
}

const commands = [
  { id: "kilo-code.new.closeTask", action: "closeTask" },
  { id: "kilo-code.new.closeAllTasks", action: "closeAllTasks" },
] as const

function capture(target: Target) {
  const messages: unknown[] = []
  const post = target.postMessage
  target.postMessage = (message) => {
    messages.push(message)
  }
  return {
    messages,
    restore: () => {
      target.postMessage = post
    },
  }
}

async function route(target: Target, others: Target[]) {
  const current = capture(target)
  const rest = others.map(capture)
  try {
    for (const command of commands) await vscode.commands.executeCommand(command.id)
    assert.deepStrictEqual(
      current.messages,
      commands.map((command) => ({ type: "action", action: command.action })),
      `others received: ${JSON.stringify(rest.map((item) => item.messages))}`,
    )
    for (const item of rest) assert.deepStrictEqual(item.messages, [])
  } finally {
    current.restore()
    for (const item of rest) item.restore()
  }
}

suite("Kilo task command integration", function () {
  this.timeout(30_000)

  test("routes task-close commands to the active Kilo surface", async () => {
    const extension = vscode.extensions.getExtension<Api>("kilocode.kilo-code")
    assert.ok(extension, "Kilo Code extension should be available to the test host")
    const api = await extension.activate()
    assert.ok(api, "Kilo Code should expose its test API in extension-test mode")

    const opened: string[] = []
    try {
      await route(api.sidebar, [api.agentManager])

      await vscode.commands.executeCommand("kilo-code.new.openInTab")
      opened.push("tab")
      const tab = api.activeTab()
      assert.ok(tab, "Open in Tab should activate a Kilo tab provider")
      await route(tab, [api.sidebar, api.agentManager])

      await vscode.commands.executeCommand("kilo-code.new.agentManagerOpen")
      opened.push("agentManager")
      assert.ok(api.agentManager.isActive(), "Agent Manager should be the active panel")
      await route(api.agentManager, [api.sidebar, tab])
    } finally {
      for (const _ of opened) await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
    }
  })
})
