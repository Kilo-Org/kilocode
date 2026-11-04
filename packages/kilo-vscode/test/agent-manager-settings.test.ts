import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as vscode from "vscode"
import { VscodeHost } from "../src/agent-manager/vscode-host"

const ROOT = join(import.meta.dir, "..")

function host(): VscodeHost {
  return new VscodeHost({} as never, {} as never)
}

describe("Agent Manager settings", () => {
  it("does not register a multi-project opt-in setting", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    expect(manifest.contributes.configuration.properties).not.toHaveProperty("kilo-code.v2.experimental.multiProject")
  })

  it.each([
    [undefined, undefined, true, ""],
    [false, "team/", false, "team/"],
    [true, "", true, ""],
  ] as const)("reads naming preferences from kilo-code.v2.agentManager (%s, %s)", (enabled, prefix, expected, text) => {
    const values = new Map<string, unknown>()
    if (enabled !== undefined) values.set("autoBranchNaming", enabled)
    if (prefix !== undefined) values.set("branchPrefix", prefix)
    const original = vscode.workspace.getConfiguration
    vscode.workspace.getConfiguration = ((section?: string) => ({
      get: (key: string, fallback: unknown) =>
        section === "kilo-code.v2.agentManager" && values.has(key) ? values.get(key) : fallback,
    })) as typeof original
    try {
      expect(host().autoBranchNaming()).toEqual({ enabled: expected, prefix: text })
    } finally {
      vscode.workspace.getConfiguration = original
    }
  })

  it("declares the diff markdown rendering setting", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    const property = manifest.contributes.configuration.properties["kilo-code.v2.diff.renderMarkdown"]
    expect(property).toMatchObject({ type: "boolean", default: false })
  })

  it("declares the naming, pool, and push-fixes settings", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    const properties = manifest.contributes.configuration.properties
    for (const key of [
      "kilo-code.v2.agentManager.autoBranchNaming",
      "kilo-code.v2.agentManager.branchPrefix",
      "kilo-code.v2.agentManager.worktreePool",
      "kilo-code.v2.agentManager.pushFixes",
    ])
      expect(properties[key]).toBeDefined()
  })

})
