import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildKeybindingMap } from "../src/agent-manager/format-keybinding"
import { mergeUserKeybindings } from "../src/keybinding-format"

const ROOT = join(import.meta.dir, "..")

type Binding = { command: string; key?: string; mac?: string; when?: string }

function manifestKeybindings(): Binding[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    contributes: { keybindings: Binding[] }
  }
  return manifest.contributes.keybindings
}

describe("Agent Manager keybindings", () => {
  it("reads every agent manager shortcut from the extension manifest", () => {
    const bindings = buildKeybindingMap(manifestKeybindings(), true)
    expect(bindings).toMatchObject({
      agentManagerOpen: "⌘⇧M",
      cycleAgentMode: "⌘.",
      cyclePreviousAgentMode: "⌘⇧.",
      search: "⌘F",
      previousSession: "⌘⌥↑",
      nextSession: "⌘⌥↓",
      previousTab: "⌘⌥←",
      nextTab: "⌘⌥→",
      previousTerminal: "⌘⇧[",
      nextTerminal: "⌘⇧]",
      showTerminal: "⌘/",
      runScript: "⌘E",
      toggleDiff: "⌘D",
      showShortcuts: "⌘⇧/",
      newTab: "⌘T",
      newTerminalCenter: "⌘⇧T",
      newTerminalTerminal: "⌘T",
      closeTab: "⌘W",
      newWorktree: "⌘N",
      quickWorktree: "⌘⇧N",
      openWorktree: "⌘⇧O",
      openPR: "⌘⇧R",
      closeWorktree: "⌘⇧W",
      jumpTo1: "⌘1",
      jumpTo9: "⌘9",
    })
  })

  it("shows user keybindings.json overrides", () => {
    const defaults = manifestKeybindings()
    const user = [
      { command: "kilo-code.v2.agentManager.newWorktree", key: "cmd+shift+y" },
      { command: "kilo-code.v2.cycleAgentMode", key: "cmd+shift+." },
    ]
    expect(buildKeybindingMap(mergeUserKeybindings(defaults, user, true), true)).toMatchObject({
      newWorktree: "⌘⇧Y",
      cycleAgentMode: "⌘⇧.",
    })
  })

  it("drops a removed shortcut instead of restoring its fallback", () => {
    const merged = mergeUserKeybindings(manifestKeybindings(), [{ command: "-kilo-code.v2.agentManager.search" }], true)
    expect(buildKeybindingMap(merged, true)).not.toHaveProperty("search")
  })
})