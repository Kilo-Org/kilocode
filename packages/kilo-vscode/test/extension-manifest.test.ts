import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

type Keybinding = { command: string; key?: string; mac?: string }
type Contribution = {
  type: string
  properties: Record<string, { type: string; description?: string }>
}
type Manifest = {
  scripts: Record<string, string>
  contributes: {
    configurationDefaults: Record<string, Record<string, boolean>>
    taskDefinitions: Contribution[]
    configuration: { properties: Record<string, { default?: unknown }> }
    keybindings: Keybinding[]
  }
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Manifest

describe("extension manifest", () => {
  it("excludes Agent Manager worktrees from the file watcher", () => {
    expect(manifest.contributes.configurationDefaults["files.watcherExclude"]).toEqual({
      "**/.kilo/worktrees/**": true,
      "**/.kilocode/worktrees/**": true,
    })
  })

  it("declares the worktree setup task the setup runner creates", () => {
    const definition = manifest.contributes.taskDefinitions.find((item) => item.type === "kilo-worktree-setup")
    expect(definition?.properties.script.type).toBe("string")
    expect(definition?.properties.worktree.type).toBe("string")
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

  it("shows the task timeline by default", () => {
    expect(manifest.contributes.configuration.properties["kilo-code.v2.showTaskTimeline"]?.default).toBe(true)
  })

  it("carries the CLI and bundles into the VSIX", () => {
    const ignore = readFileSync(join(root, ".vscodeignore"), "utf8").split(/\r?\n/)
    expect(ignore).toContain("!dist/**")
    expect(ignore).toContain("!bin/**")
    expect(ignore).toContain("!assets/**")
    expect(manifest.scripts.package).toBe("bun script/package.ts")
  })
})