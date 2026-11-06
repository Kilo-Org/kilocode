import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { clearLegacyTerminalDestination } from "../src/agent-manager/terminal-host"

const SECTION = "kilo-code.v2.agentManager"
const KEY = "terminalButtonDestination"

describe("retired terminal destination setting", () => {
  const descriptors = Object.getOwnPropertyDescriptors(vscode.workspace)
  let reads: Array<{ section: string; key: string }> = []
  let writes: Array<{ section: string; key: string; value: unknown; target: unknown }> = []

  function config(value: string | undefined) {
    reads = []
    writes = []
    vscode.workspace.getConfiguration = ((section: string) =>
      ({
        inspect: (key: string) => {
          reads.push({ section, key })
          return section === SECTION && key === KEY ? { globalValue: value } : {}
        },
        update: async (key: string, next: unknown, target: unknown) => {
          writes.push({ section, key, value: next, target })
        },
      }) as unknown as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration
  }

  afterEach(() => {
    Object.defineProperties(vscode.workspace, descriptors)
  })

  test("clears a stored destination from the global settings", async () => {
    config("vscode")
    await clearLegacyTerminalDestination()
    expect(reads).toEqual([{ section: SECTION, key: KEY }])
    expect(writes).toEqual([
      { section: SECTION, key: KEY, value: undefined, target: vscode.ConfigurationTarget.Global },
    ])
  })

  test("does not write when no destination is stored", async () => {
    config(undefined)
    await clearLegacyTerminalDestination()
    expect(writes).toEqual([])
  })
})
