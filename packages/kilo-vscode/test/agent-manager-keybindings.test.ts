import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildKeybindingMap } from "../src/agent-manager/format-keybinding"
import { mergeUserKeybindings } from "../src/keybinding-format"

const ROOT = join(import.meta.dir, "..")

type Binding = { command: string; key?: string; mac?: string; when?: string }
type Manifest = {
  scripts: Record<string, string>
  repository: { type: string; url: string; directory: string }
  contributes: {
    configurationDefaults: Record<string, Record<string, boolean>>
    configuration: { properties: Record<string, { default?: unknown }> }
    keybindings: Binding[]
  }
}

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Manifest

function manifestKeybindings(): Binding[] {
  return manifest.contributes.keybindings
}

describe("Agent Manager keybindings", () => {
  it("reads every agent manager shortcut from the extension manifest", () => {
    const bindings = buildKeybindingMap(manifestKeybindings(), true)
    expect(bindings).toMatchObject({
      agentManagerOpen: "⌘⇧M",
      cycleAgentMode: "⌘.",
      cyclePreviousAgentMode: "⌘⇧.",
      search: "⌘⇧F",
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

  it("binds worktree search to Cmd+Shift+F and keeps Cmd+F for v1 parity", () => {
    const search = manifestKeybindings()
      .filter((binding) => binding.command === "kilo-code.v2.agentManager.search")
      .map((binding) => ({ key: binding.key, mac: binding.mac, when: binding.when }))
    expect(search).toEqual([
      {
        key: "ctrl+f",
        mac: "cmd+f",
        when: "activeWebviewPanelId == 'kilo-code.v2.agentManagerPanel' && !terminalFocus",
      },
      {
        key: "ctrl+shift+f",
        mac: "cmd+shift+f",
        when: "activeWebviewPanelId == 'kilo-code.v2.agentManagerPanel' && !terminalFocus",
      },
    ])
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

describe("extension manifest", () => {
  it("excludes Agent Manager worktrees from the file watcher", () => {
    expect(manifest.contributes.configurationDefaults["files.watcherExclude"]).toEqual({
      "**/.kilo/worktrees/**": true,
      "**/.kilocode/worktrees/**": true,
    })
  })

  it("unbinds the Problems view from the Agent Manager shortcut", () => {
    const unbind = manifest.contributes.keybindings.findIndex(
      (binding) => binding.command === "-workbench.actions.view.problems" && binding.key === "ctrl+shift+m",
    )
    const open = manifest.contributes.keybindings.findIndex(
      (binding) => binding.command === "kilo-code.v2.agentManager.open" && binding.key === "ctrl+shift+m",
    )
    expect(unbind).toBeGreaterThanOrEqual(0)
    expect(open).toBe(unbind + 1)
  })

  it("collapses the task timeline by default", () => {
    expect(manifest.contributes.configuration.properties["kilo-code.v2.showTaskTimeline"]?.default).toBe(false)
  })

  it("carries the CLI and bundles into the VSIX", () => {
    const ignore = readFileSync(join(ROOT, ".vscodeignore"), "utf8").split(/\r?\n/)
    expect(ignore).toContain("!dist/**")
    expect(ignore).toContain("!bin/**")
    expect(ignore).toContain("!assets/**")
    expect(manifest.scripts.package).toBe("bun script/package.ts")
  })

  it("declares the repository the VSIX links to", () => {
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/Kilo-Org/kilocode.git",
      directory: "packages/kilo-vscode",
    })
  })
})