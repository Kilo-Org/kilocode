import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { SidePanel } from "../../webview-ui/agent-manager/side-panel-layout"
import { createSidePanel } from "../../webview-ui/agent-manager/side-panel-state"
import {
  createEditPreview,
  diffCounts,
  isEditPreviewDiff,
  previewMatchesContext,
  sessionTreeContains,
  sessionWorktree,
} from "../../webview-ui/agent-manager/edit-preview"

const diff = {
  file: "src/example.ts",
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  additions: 1,
  deletions: 1,
}

function scene(context: string) {
  const [project, activate] = createSignal("project")
  const [current, select] = createSignal("parent")
  const [selection, navigate] = createSignal(context)
  const sessions = [
    { id: "parent" },
    { id: "sibling" },
    { id: "child", parentID: "parent" },
    { id: "nested", parentID: "child" },
  ]
  const managed =
    context === "local"
      ? []
      : [
          { id: "parent", worktreeId: context },
          { id: "sibling", worktreeId: context },
        ]
  const panels = createSidePanel({
    project,
    current,
    selection,
    visible: (panel) => panel !== SidePanel.EditPreview || !!preview.preview(),
  })
  const preview = createEditPreview({
    context: panels.session,
    matches: (id) =>
      previewMatchesContext(
        id,
        current(),
        selection(),
        id ? sessionWorktree(id, sessions, managed) : undefined,
        (child, parent) => sessionTreeContains(child, parent, sessions),
      ),
    show: () => panels.open(SidePanel.EditPreview),
    hide: () => panels.close(SidePanel.EditPreview),
  })
  return { preview, panels, activate, select, navigate }
}

describe("Agent Manager edit preview", () => {
  it.each(["local", "worktree"])("retains preview content and preferences per parent and project in %s", (context) => {
    createRoot((dispose) => {
      const state = scene(context)
      state.preview.open(diff, "parent", "split")
      state.preview.updateMarkdown(true)
      const first = state.preview.preview()
      state.select("sibling")
      expect(state.preview.preview()).toBeUndefined()
      expect(state.panels.panel()).toBeNull()
      state.preview.open({ ...diff, file: "sibling.ts" }, "sibling")
      state.activate("other")
      expect(state.preview.preview()).toBeUndefined()
      expect(state.panels.panel()).toBeNull()
      state.preview.open({ ...diff, file: "other-project.ts" }, "sibling")
      state.activate("project")
      expect(state.preview.preview()?.diff.file).toBe("sibling.ts")
      state.select("parent")
      expect(state.preview.preview()).toBe(first)
      expect(state.preview.preview()?.style).toBe("split")
      expect(state.preview.preview()?.markdown).toBe(true)
      expect(state.panels.panel()).toBe(SidePanel.EditPreview)
      state.preview.close()
      state.select("sibling")
      expect(state.preview.preview()?.diff.file).toBe("sibling.ts")
      state.select("parent")
      expect(state.preview.preview()).toBeUndefined()
      expect(state.panels.panel()).toBeNull()
      dispose()
    })
  })

  it("rejects foreign preview events and hides invalid source contexts without deleting their payload", () => {
    createRoot((dispose) => {
      const state = scene("worktree")
      state.panels.open(SidePanel.Diff)
      for (const id of [undefined, "sibling", "unknown"]) state.preview.open(diff, id)
      expect(state.preview.preview()).toBeUndefined()
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      state.preview.open(diff, "nested")
      const first = state.preview.preview()
      expect(first?.sessionID).toBe("nested")
      state.navigate("other")
      expect(state.preview.preview()).toBeUndefined()
      expect(state.panels.panel()).toBeNull()
      state.preview.open({ ...diff, file: "wrong-context.ts" }, "nested")
      state.navigate("worktree")
      expect(state.preview.preview()).toBe(first)
      expect(state.panels.panel()).toBe(SidePanel.EditPreview)
      state.select("sibling")
      state.preview.open(diff, "nested")
      expect(state.preview.preview()).toBeUndefined()
      expect(state.panels.panel()).toBe(SidePanel.Diff)
      state.select("parent")
      expect(state.preview.preview()).toBe(first)
      dispose()
    })
  })

  it("replaces the current patch and opens the inspector", () => {
    createRoot((dispose) => {
      const calls = { shown: 0, hidden: 0 }
      const preview = createEditPreview({
        show: () => calls.shown++,
        hide: () => calls.hidden++,
      })

      preview.open(diff, "session-1", "unified")
      expect(preview.preview()).toEqual({ diff, sessionID: "session-1", style: "unified", markdown: false })

      preview.open({ ...diff, file: "src/next.ts" }, "session-2")
      expect(preview.preview()?.diff.file).toBe("src/next.ts")
      expect(preview.preview()?.style).toBe("unified")
      expect(calls.shown).toBe(2)

      preview.close()
      expect(preview.preview()).toBeUndefined()
      expect(calls.hidden).toBe(1)
      dispose()
    })
  })

  it("updates the display preferences without changing the patch", () => {
    createRoot((dispose) => {
      const preview = createEditPreview({ show: () => undefined, hide: () => undefined })
      preview.open(diff)
      preview.updateStyle("unified")
      preview.updateMarkdown(true)

      expect(preview.preview()?.diff).toEqual(diff)
      expect(preview.preview()?.style).toBe("unified")
      expect(preview.preview()?.markdown).toBe(true)
      dispose()
    })
  })

  it("uses the shared style when opening a preview", () => {
    createRoot((dispose) => {
      const style = () => "split" as const
      const changes: string[] = []
      const preview = createEditPreview({
        show: () => undefined,
        hide: () => undefined,
        style,
        onStyleChange: (value) => changes.push(value),
      })
      preview.open(diff)
      expect(preview.preview()?.style).toBe("split")
      preview.updateStyle("unified")
      expect(changes).toEqual(["unified"])
      dispose()
    })
  })

  it("validates edit preview payloads", () => {
    expect(isEditPreviewDiff(diff)).toBe(true)
    expect(
      isEditPreviewDiff({
        ...diff,
        files: [diff, { ...diff, file: "src/other.ts" }],
      }),
    ).toBe(true)
    expect(isEditPreviewDiff({ ...diff, additions: "1" })).toBe(false)
    expect(isEditPreviewDiff({ file: "src/example.ts" })).toBe(false)
    expect(isEditPreviewDiff({ ...diff, files: [] })).toBe(false)
  })

  it("keeps a preview scoped to its current session and worktree", () => {
    expect(previewMatchesContext("session-1", "session-1", "wt-1", "wt-1")).toBe(true)
    expect(previewMatchesContext("session-1", "session-2", "wt-1", "wt-1")).toBe(false)
    expect(previewMatchesContext("session-1", "session-1", "wt-2", "wt-1")).toBe(false)
    expect(previewMatchesContext("session-1", "session-1", "local", undefined)).toBe(true)
    expect(previewMatchesContext("session-1", "session-1", null, undefined)).toBe(true)
    expect(previewMatchesContext("session-1", "session-1", "wt-1", undefined)).toBe(false)
  })

  it("keeps nested subagent previews in the parent worktree", () => {
    const sessions = [
      { id: "parent", parentID: null },
      { id: "child", parentID: "parent" },
      { id: "grandchild", parentID: "child" },
    ]
    const managed = [{ id: "parent", worktreeId: "wt-1" }]

    expect(sessionTreeContains("grandchild", "parent", sessions)).toBe(true)
    expect(sessionTreeContains("parent", "grandchild", sessions)).toBe(false)
    expect(sessionWorktree("grandchild", sessions, managed)).toBe("wt-1")
    expect(
      previewMatchesContext("grandchild", "parent", "wt-1", "wt-1", (child, root) =>
        sessionTreeContains(child, root, sessions),
      ),
    ).toBe(true)
  })

  it("preserves explicit zero counts and excludes hunk context from fallbacks", () => {
    const hunks = [{ additionLines: 1, deletionLines: 0 }]
    expect(diffCounts({ additions: 0, deletions: 0 }, hunks, "added")).toEqual({ additions: 1, deletions: 0 })
    expect(diffCounts({ additions: 0, deletions: 0 }, hunks, "modified")).toEqual({ additions: 0, deletions: 0 })
    expect(diffCounts({ additions: 4, deletions: 0 }, [{ additionLines: 2, deletionLines: 1 }], "deleted")).toEqual({
      additions: 4,
      deletions: 1,
    })
  })
})
