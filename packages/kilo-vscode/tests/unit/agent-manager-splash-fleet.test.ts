import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { examples } from "../../webview-ui/agent-manager/splash/examples"
import { fleet } from "../../webview-ui/agent-manager/splash/fleet"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { buildProjectNavEntries, navSelector } from "../../webview-ui/agent-manager/project-nav"
import { buildShortcutMap } from "../../webview-ui/agent-manager/section-helpers"

describe("splash sidebar adapter", () => {
  it("preserves canonical fixture ordering and leaves every section uncollapsed", () => {
    const cross = examples.at(0)!
    const ops = examples.at(2)!
    expect(fleet(cross).map((row) => row.project.label)).toEqual(["billing-api", "web-app", "infra"])
    expect(cross.fixture.projects.map((project) => project.name)).toEqual(["billing-api", "web-app", "infra"])
    const row = fleet(ops).at(0)!
    expect(row.state.sections!.map((section) => [section.name, section.collapsed])).toEqual([
      ["IMPLEMENT", false],
      ["OPS", false],
    ])
    expect(row.state.worktrees.filter((wt) => wt.sectionId === row.state.sections!.at(0)?.id)).toHaveLength(2)
    expect(row.state.worktreeOrder).toEqual(
      row.state.sections!.flatMap((section) => [
        section.id,
        ...row.state.worktrees.filter((wt) => wt.sectionId === section.id).map((wt) => wt.id),
      ]),
    )
    createRoot((dispose) => {
      for (const example of examples) {
        const rows = fleet(example)
        expect(rows.map((row) => row.project.label)).toEqual(example.fixture.projects.map((project) => project.name))
        for (const row of rows) {
          const store = createProjectStore(row.project.id)
          store.applyState(row.state)
          expect(store.sections().every((section) => section.collapsed === false)).toBe(true)
          expect(store.worktrees()).toEqual(row.state.worktrees)
        }
      }
      dispose()
    })
  })

  it("selects exactly one worktree in every example", () => {
    for (const example of examples) {
      const rows = fleet(example)
      const selected = rows.filter((row) => row.selection !== undefined)
      expect(selected).toHaveLength(1)
      const row = selected.at(0)!
      expect(row.project.active).toBe(true)
      expect(row.state.worktrees.some((wt) => wt.id === row.selection)).toBe(true)
    }
    const row = fleet(examples.at(1)!).at(0)!
    expect(row.state.worktrees.find((wt) => wt.id === row.selection)?.label).toBe(
      "Orchestrator · scheduler latency pass",
    )
  })

  it("maps real activity, selection, stats and approved successful PRs", () => {
    const rows = fleet(examples.at(0)!)
    expect(rows.map((row) => Object.values(row.activity))).toEqual([["busy"], ["done"], ["waiting"]])
    const first = rows.at(0)!
    const key = first.state.worktrees.at(0)!.id
    expect(first.stats[key]).toEqual({ worktreeId: key, files: 0, additions: 142, deletions: 18, ahead: 0, behind: 0 })
    expect(first.local).toEqual({ branch: "main", files: 0, additions: 0, deletions: 0, ahead: 0, behind: 0 })
    const selected = rows.at(1)!
    expect(selected.project.active).toBe(true)
    expect(selected.selection).toBe(selected.state.worktrees.at(0)!.id)
    expect(selected.prs[selected.selection!]).toMatchObject({
      number: 889,
      state: "open",
      review: "approved",
      checks: { status: "success", pending: 0, failed: 0 },
    })
    expect(selected.stats[selected.selection!]).toMatchObject({ additions: 0, deletions: 0 })
    const beyond = fleet(examples.at(4)!).at(0)!
    expect(beyond.activity[beyond.state.worktrees.at(-1)!.id]).toBe("idle")
  })

  it("preserves versions, section colors and visual ordering through real project stores", () => {
    createRoot((dispose) => {
      for (const example of examples) {
        for (const row of fleet(example)) {
          const store = createProjectStore(row.project.id)
          store.applyState(row.state)
          expect(store.worktrees()).toEqual(row.state.worktrees)
          expect(store.sections()).toEqual(row.state.sections!)
          expect(store.worktreeOrder()).toEqual(row.state.worktreeOrder!)
        }
      }
      dispose()
    })
    const versions = fleet(examples.at(3)!).at(0)!
    expect(new Set(versions.state.worktrees.map((wt) => wt.groupId)).size).toBe(1)
    expect(versions.state.worktrees.at(0)!.groupId).toBeTruthy()
    expect(versions.state.worktreeOrder).toEqual(versions.state.worktrees.map((wt) => wt.id))
    const orchestration = fleet(examples.at(1)!).at(0)!
    const sections = orchestration.state.sections!
    expect(sections.map((section) => [section.name, section.color, section.collapsed, section.order])).toEqual([
      ["ORCHESTRATE", "Purple", false, 1],
      ["PATCHES", "Blue", false, 2],
    ])
    expect(orchestration.state.worktreeOrder).toEqual([
      sections.at(0)!.id,
      orchestration.state.worktrees.at(0)!.id,
      sections.at(1)!.id,
      ...orchestration.state.worktrees.slice(1).map((wt) => wt.id),
    ])
    expect(orchestration.state.worktrees.at(0)).toMatchObject({
      sectionId: sections.at(0)!.id,
      branch: "started 3 sessions · 1 done",
      label: "Orchestrator · scheduler latency pass",
    })
    expect(orchestration.state.worktrees.slice(1).every((wt) => wt.sectionId === sections.at(1)!.id)).toBe(true)
    const ops = fleet(examples.at(2)!).at(0)!
    const implementation = ops.state.sections!.find((section) => section.name === "IMPLEMENT")!
    expect(ops.state.worktrees).toHaveLength(5)
    expect(ops.state.worktrees.filter((wt) => wt.sectionId === implementation.id)).toHaveLength(2)
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
