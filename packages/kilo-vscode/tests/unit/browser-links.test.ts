import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { openBrowserLink } from "../../src/browser-links"

describe("Chat link destination", () => {
  const workspace = Object.getOwnPropertyDescriptors(vscode.workspace)
  const env = Object.getOwnPropertyDescriptors(vscode.env)
  const uri = Object.getOwnPropertyDescriptors(vscode.Uri)

  afterEach(() => {
    Object.defineProperties(vscode.workspace, workspace)
    Object.defineProperties(vscode.env, env)
    Object.defineProperties(vscode.Uri, uri)
  })

  function setup(input: { destination?: string; enabled?: boolean; trusted?: boolean } = {}) {
    const external: string[] = []
    Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, value: input.trusted !== false })
    vscode.workspace.getConfiguration = (() =>
      ({
        get: (key: string, fallback: unknown) =>
          key === "openLinksIn"
            ? (input.destination ?? "integrated")
            : key === "browserAutomation"
              ? input.enabled !== false
              : fallback,
      }) as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration
    vscode.Uri.parse = ((value: string) => value) as unknown as typeof vscode.Uri.parse
    vscode.env.openExternal = async (target) => {
      external.push(String(target))
      return true
    }
    return external
  }

  test("opens in the Integrated Browser when the opener accepts the link", async () => {
    const external = setup()
    const opened: string[] = []
    await openBrowserLink("https://example.com", () => {
      opened.push("https://example.com")
      return true
    })
    expect(opened).toEqual(["https://example.com"])
    expect(external).toEqual([])
  })

  test("falls back to the system browser when the opener cannot take the link", async () => {
    const external = setup()
    await openBrowserLink("https://example.com", () => false)
    expect(external).toEqual(["https://example.com"])
  })

  test("falls back to the system browser when no in-app opener is available", async () => {
    const external = setup()
    await openBrowserLink("https://example.com")
    expect(external).toEqual(["https://example.com"])
  })

  test("falls back to the system browser when the opener throws", async () => {
    const external = setup()
    await openBrowserLink("https://example.com", () => {
      throw new Error("Browser tab unavailable")
    })
    expect(external).toEqual(["https://example.com"])
  })

  test.each([{ destination: "external" }, { enabled: false }, { trusted: false }])(
    "opens externally when in-app routing is unavailable: %j",
    async (input) => {
      const external = setup(input)
      const opened: string[] = []
      await openBrowserLink("https://example.com", () => {
        opened.push("yes")
        return true
      })
      expect(opened).toEqual([])
      expect(external).toEqual(["https://example.com"])
    },
  )

  test("leaves non-web schemes with VS Code's external opener", async () => {
    const external = setup()
    await openBrowserLink("mailto:test@example.com", () => true)
    expect(external).toEqual(["mailto:test@example.com"])
  })
})
