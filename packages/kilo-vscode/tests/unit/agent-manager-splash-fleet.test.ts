import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { examples } from "../../webview-ui/agent-manager/splash/examples"
import { fleet } from "../../webview-ui/agent-manager/splash/fleet"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { buildProjectNavEntries, navSelector } from "../../webview-ui/agent-manager/project-nav"
import { buildShortcutMap } from "../../webview-ui/agent-manager/section-helpers"

describe("splash sidebar adapter", () => {
  it("selects exactly one worktree in every example", () => {
    for (const example of examples) {
      const rows = fleet(example)
      const selected = rows.filter((row) => row.selection !== undefined)
      expect(selected).toHaveLength(1)
      const row = selected.at(0)!
      expect(row.project.active).toBe(true)
      expect(row.state.worktrees.some((wt) => wt.id === row.selection)).toBe(true)
    }
  })

  it("preserves fixture project order and expanded sections through real project stores", () => {
    createRoot((dispose) => {
      for (const example of examples) {
        const rows = fleet(example)
        expect(rows.map((row) => row.project.label)).toEqual(example.fixture.projects.map((project) => project.name))
        for (const row of rows) {
          const store = createProjectStore(row.project.id)
          store.applyState(row.state)
          expect(store.worktrees()).toEqual(row.state.worktrees)
          expect(store.sections()).toEqual(row.state.sections!)
          expect(store.sections().every((section) => section.collapsed === false)).toBe(true)
          expect(store.worktreeOrder()).toEqual(row.state.worktreeOrder!)
        }
      }
      dispose()
    })
  })

  it("uses unique splash-only identities and the real cross-project shortcut order", () => {
    const ids: string[] = []
    for (const example of examples) {
      const rows = fleet(example)
      const projects = rows.map((row) => row.project)
      const states = Object.fromEntries(rows.map((row) => [row.project.id, row.state]))
      const entries = buildProjectNavEntries(projects, states)
      const shortcuts = buildShortcutMap(entries)
      rows.forEach((row) => {
        expect(row.project.id).toBe(`splash:${example.id}:${row.project.root}`)
        ids.push(row.project.id, ...row.state.worktrees.map((wt) => wt.id), ...row.state.sections!.map((s) => s.id))
        expect(shortcuts.get(`${row.project.id}:local`)).toBeDefined()
      })
      entries.forEach((entry, index) => {
        if (index < 9) expect(shortcuts.get(entry.id)).toBe(index + 1)
        expect(navSelector(entry.target)).toContain('="splash:')
      })
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
})
