import { describe, expect, it } from "bun:test"
import { PanelProjectDirectory, resolvePanelProjectDirectory } from "../../src/project-directory"

/** Mimics the provider: records every directory applied to the panel. */
function setup(initial: string | null, state: { resolved: string | null }) {
  const applied: string[] = []
  const panel = new PanelProjectDirectory(
    initial,
    () => state.resolved,
    (dir) => applied.push(dir),
  )
  return { panel, applied }
}

describe("settings panel project directory refresh (#16179)", () => {
  it("a panel restored with no workspace folders resolves null", () => {
    expect(resolvePanelProjectDirectory(undefined, undefined)).toBeNull()
    expect(resolvePanelProjectDirectory(undefined, [])).toBeNull()
  })

  it("adopts the directory once it becomes resolvable (null to resolved)", () => {
    const state = { resolved: null as string | null }
    const { panel, applied } = setup(null, state)
    panel.refresh()
    expect(applied).toEqual([])
    state.resolved = "/repo"
    panel.refresh()
    expect(applied).toEqual(["/repo"])
  })

  it("does not apply anything while still unresolved", () => {
    const { panel, applied } = setup(null, { resolved: null })
    panel.refresh()
    panel.refresh()
    expect(applied).toEqual([])
  })

  it("keeps an already-resolved project bound when the active editor moves to another project", () => {
    const state = { resolved: "/b" as string | null }
    const { panel, applied } = setup("/a", state)
    panel.refresh()
    expect(applied).toEqual([])
  })

  it("keeps the recovered project bound on later refreshes", () => {
    const state = { resolved: "/a" as string | null }
    const { panel, applied } = setup(null, state)
    panel.refresh()
    state.resolved = "/b"
    panel.refresh()
    expect(applied).toEqual(["/a"])
  })

  it("an explicit bind() of null re-enables recovery", () => {
    const state = { resolved: "/b" as string | null }
    const { panel, applied } = setup("/a", state)
    panel.bind(null)
    panel.refresh()
    expect(applied).toEqual(["/b"])
  })
})
