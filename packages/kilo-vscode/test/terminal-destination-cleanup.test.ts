import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { clearLegacyTerminalDestination } from "../src/agent-manager/terminal-host"

describe("retired terminal destination setting", () => {
  const descriptors = Object.getOwnPropertyDescriptors(vscode.workspace)
  let writes: Array<{ key: string; value: unknown; target: unknown }> = []

  function config(value: string | undefined) {
    writes = []
    vscode.workspace.getConfiguration = ((_section: string) =>
      ({
        inspect: () => ({ globalValue: value }),
        update: async (key: string, next: unknown, target: unknown) => {
          writes.push({ key, value: next, target })
        },
      }) as unknown as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration
  }

  afterEach(() => {
    Object.defineProperties(vscode.workspace, descriptors)
  })

  test("clears a stored destination from the global settings", async () => {
    config("vscode")
    await clearLegacyTerminalDestination()
    expect(writes).toEqual([
      { key: "terminalButtonDestination", value: undefined, target: vscode.ConfigurationTarget.Global },
    ])
  })

  test("does not write when no destination is stored", async () => {
    config(undefined)
    await clearLegacyTerminalDestination()
    expect(writes).toEqual([])
  })
})
