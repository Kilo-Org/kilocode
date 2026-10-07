import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { openBrowserLink } from "../../src/browser-links"

describe("Chat browser destination", () => {
  const workspace = Object.getOwnPropertyDescriptors(vscode.workspace)
  const commands = Object.getOwnPropertyDescriptors(vscode.commands)
  const env = Object.getOwnPropertyDescriptors(vscode.env)

  afterEach(() => {
    Object.defineProperties(vscode.workspace, workspace)
    Object.defineProperties(vscode.commands, commands)
    Object.defineProperties(vscode.env, env)
  })

  function setup(input: { destination?: string; enabled?: boolean; trusted?: boolean; fail?: boolean } = {}) {
    const calls: Array<{ command: string; uri: vscode.Uri }> = []
    Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, value: input.trusted !== false })
    vscode.workspace.getConfiguration = (() =>
      ({
        get: (key: string, fallback: unknown) =>
          key === "openLinksIn"
            ? (input.destination ?? fallback)
            : key === "browserAutomation"
              ? input.enabled !== false
              : fallback,
      }) as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration
    vscode.commands.executeCommand = (async (command: string, uri: vscode.Uri) => {
      calls.push({ command, uri })
      if (input.fail) throw new Error("Browser navigation failed")
    }) as typeof vscode.commands.executeCommand
    vscode.env.openExternal = async (uri) => {
      calls.push({ command: "external", uri })
      return true
    }
    return calls
  }

  test("defaults to the browser tab when the flag is on and nothing is saved", async () => {
    const calls = setup()
    await openBrowserLink("https://example.com")
    expect(calls).toEqual([{ command: "simpleBrowser.api.open", uri: vscode.Uri.parse("https://example.com") }])
  })

  test("does not open the external browser after a tab navigation error", async () => {
    const calls = setup({ fail: true })
    await expect(openBrowserLink("https://example.com")).rejects.toThrow("Browser navigation failed")
    expect(calls.map((call) => call.command)).toEqual(["simpleBrowser.api.open"])
  })

  test.each([{ destination: "external" }, { enabled: false }, { trusted: false }])(
    "opens externally when the user opts out or integration is unavailable: %j",
    async (input) => {
      const calls = setup(input)
      await openBrowserLink("https://example.com")
      expect(calls).toEqual([{ command: "external", uri: vscode.Uri.parse("https://example.com") }])
    },
  )

  test("leaves non-web schemes with VS Code's external opener", async () => {
    const calls = setup()
    await openBrowserLink("mailto:test@example.com")
    expect(calls).toEqual([{ command: "external", uri: vscode.Uri.parse("mailto:test@example.com") }])
  })
})
