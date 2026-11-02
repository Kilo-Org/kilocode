import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { AutocompleteStatusBar } from "../src/services/autocomplete/AutocompleteStatusBar"

const original = vscode.window.createStatusBarItem
const item = {
  text: "",
  tooltip: undefined as unknown,
  command: undefined as unknown,
  show: mock(),
  hide: mock(),
  dispose: mock(),
}

afterEach(() => {
  ;(vscode.window as unknown as Record<string, unknown>).createStatusBarItem = original
})

describe("AutocompleteStatusBar", () => {
  it("opens Settings on the Autocomplete tab when the item is clicked", () => {
    ;(vscode.window as unknown as Record<string, unknown>).createStatusBarItem = () => item
    new AutocompleteStatusBar({
      enabled: true,
      model: "Codestral",
      provider: "Kilo Gateway",
      totalSessionCost: 0,
      completionCount: 0,
      sessionStartTime: Date.now(),
    })

    expect(item.command).toEqual({
      command: "kilo-code.v2.settings",
      title: "Autocomplete",
      arguments: ["autocomplete"],
    })
    expect(item.show).toHaveBeenCalled()
  })
})
