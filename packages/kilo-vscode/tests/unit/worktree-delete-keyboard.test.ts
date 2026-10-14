import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { createRoot } from "solid-js"
import { createDiffPanelFocus } from "../../webview-ui/agent-manager/diff-panel-focus"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { createDeleteKey, createWorktreeDelete } from "../../webview-ui/agent-manager/worktree-delete"

function setup() {
  return createRoot((dispose) => {
    const window = new Window()
    const view = window as unknown as typeof globalThis.window
    const doc = window.document
    const state = { selection: "wt" as string | undefined }
    const store = createProjectStore("project")
    store.setWorktrees([{ id: "wt", branch: "wt", path: "/repo/wt", parentBranch: "main", createdAt: "2026-10-09" }])
    const removed: string[][] = []
    const deletion = createWorktreeDelete({
      store: () => store,
      project: () => "project",
      selection: () => state.selection,
      busy: (_, id) => store.busy().has(id),
      blocked: () => false,
      select: (target) => {
        state.selection = target.kind === "worktree" ? target.worktreeId : LOCAL
      },
      remove: (project, id) => removed.push([project, id]),
      reveal: () => {},
      view,
    })
    const focus = createDiffPanelFocus({
      isOpen: () => false,
      open: () => {},
      close: () => {},
      closeHistory: () => {},
      focusPrompt: () => {},
      track: () => {},
    })
    // The app wires the same handler to the same confirmation helper.
    window.addEventListener(
      "keydown",
      createDeleteKey({
        guard: focus.isFocusTarget,
        selection: () => state.selection,
        close: () => deletion.confirm("project", "wt"),
      }),
    )
    const press = (key: string, repeat = false, target = doc.body) => {
      const event = new window.KeyboardEvent("keydown", { key, repeat, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event
    }
    // VS Code shortcuts reach the webview as a keydown, then as a host action message.
    const shortcut = (key: string, repeat = false) => {
      press(key, repeat)
      deletion.confirm("project", "wt")
    }
    return { dispose, state, store, deletion, removed, doc, press, shortcut }
  })
}

describe("worktree delete keyboard confirmation", () => {
  for (const key of ["Backspace", "Delete"]) {
    it(`does not confirm deletion while holding ${key}`, async () => {
      const fixture = setup()
      try {
        expect(fixture.press(key).defaultPrevented).toBe(true)
        expect(fixture.deletion.pending()).toEqual({ projectId: "project", worktreeId: "wt" })
        for (let i = 0; i < 3; i++) expect(fixture.press(key, true).defaultPrevented).toBe(true)
        expect(fixture.removed).toEqual([])
        expect(fixture.store.busy().has("wt")).toBe(false)
        expect(fixture.deletion.pending()).toEqual({ projectId: "project", worktreeId: "wt" })
        await Bun.sleep(350)
        fixture.press(key)
        expect(fixture.removed).toEqual([["project", "wt"]])
        expect(fixture.store.busy().get("wt")?.reason).toBe("deleting")
      } finally {
        fixture.dispose()
      }
    })

    it(`confirms deletion from two quick ${key} presses`, () => {
      const fixture = setup()
      try {
        fixture.press(key)
        fixture.press(key)
        expect(fixture.removed).toEqual([["project", "wt"]])
      } finally {
        fixture.dispose()
      }
    })

    it(`does not arm confirmation from a repeated ${key} event`, () => {
      const fixture = setup()
      try {
        fixture.press(key, true)
        expect(fixture.deletion.pending()).toBeUndefined()
        expect(fixture.removed).toEqual([])
      } finally {
        fixture.dispose()
      }
    })

    it(`preserves text and diff focus guards for ${key}`, () => {
      const fixture = setup()
      try {
        fixture.doc.body.innerHTML =
          '<input><textarea></textarea><div contenteditable="true"></div><div class="am-diff-panel"><button></button></div><div class="am-review-layout"><button></button></div>'
        for (const target of fixture.doc.querySelectorAll("input, textarea, [contenteditable], button")) {
          expect(fixture.press(key, false, target).defaultPrevented).toBe(false)
          expect(fixture.deletion.pending()).toBeUndefined()
        }
        expect(fixture.removed).toEqual([])
      } finally {
        fixture.dispose()
      }
    })
  }

  it("does not confirm deletion while holding a close shortcut", async () => {
    const fixture = setup()
    try {
      fixture.shortcut("w")
      expect(fixture.deletion.pending()).toEqual({ projectId: "project", worktreeId: "wt" })
      for (let i = 0; i < 3; i++) fixture.shortcut("w", true)
      expect(fixture.removed).toEqual([])
      expect(fixture.deletion.pending()).toEqual({ projectId: "project", worktreeId: "wt" })
      await Bun.sleep(350)
      fixture.shortcut("w")
      expect(fixture.removed).toEqual([["project", "wt"]])
    } finally {
      fixture.dispose()
    }
  })

  it("does not block a close shortcut while modifiers repeat", () => {
    const fixture = setup()
    try {
      fixture.press("Shift", true)
      fixture.press("Control", true)
      fixture.shortcut("w")
      expect(fixture.deletion.pending()).toEqual({ projectId: "project", worktreeId: "wt" })
      fixture.press("Shift", true)
      fixture.shortcut("w")
      expect(fixture.removed).toEqual([["project", "wt"]])
    } finally {
      fixture.dispose()
    }
  })

  it.each([undefined, LOCAL])("ignores a selection of %s", (selection) => {
    const fixture = setup()
    try {
      fixture.state.selection = selection
      expect(fixture.press("Backspace").defaultPrevented).toBe(false)
      expect(fixture.deletion.pending()).toBeUndefined()
      expect(fixture.removed).toEqual([])
    } finally {
      fixture.dispose()
    }
  })
})
