import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { createRoot } from "solid-js"
import { Project, SyntaxKind } from "ts-morph"
import { createDiffPanelFocus } from "../../webview-ui/agent-manager/diff-panel-focus"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { createWorktreeDelete } from "../../webview-ui/agent-manager/worktree-delete"

// Run the production key handler without mounting the full application or
// replacing the store, confirmation helper, or diff focus guard with mocks.
const source = new Project({ skipAddingFilesFromTsConfig: true }).addSourceFileAtPath(
  `${import.meta.dir}/../../webview-ui/agent-manager/AgentManagerApp.tsx`,
)
const declaration = source
  .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
  .find((node) => node.getName() === "deleteKeyHandler")
if (!declaration) throw new Error("Worktree delete key handler not found")
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
  `const handler = ${declaration.getInitializerOrThrow().getText()}`,
)
// This factory compiles only the local handler and supplies its typed closure dependencies.
// oxlint-disable-next-line typescript-eslint(no-implied-eval), typescript-eslint(no-unsafe-type-assertion)
const compile = new Function(
  "selection",
  "LOCAL",
  "diffPanels",
  "closeSelectedWorktree",
  `${code}; return handler`,
) as (
  selection: () => string | undefined,
  local: string,
  focus: Pick<ReturnType<typeof createDiffPanelFocus>, "isFocusTarget">,
  close: () => void,
) => (event: KeyboardEvent) => void

function setup() {
  return createRoot((dispose) => {
    const window = new Window()
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
    })
    const focus = createDiffPanelFocus({
      isOpen: () => false,
      open: () => {},
      close: () => {},
      closeHistory: () => {},
      focusPrompt: () => {},
      track: () => {},
    })
    window.addEventListener(
      "keydown",
      compile(
        () => state.selection,
        LOCAL,
        focus,
        () => deletion.confirm("project", "wt"),
      ),
    )
    const press = (key: string, repeat = false, target = doc.body) => {
      const event = new window.KeyboardEvent("keydown", { key, repeat, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event
    }
    return { dispose, state, store, deletion, removed, doc, press }
  })
}

describe("worktree delete keyboard confirmation", () => {
  for (const key of ["Backspace", "Delete"]) {
    it(`does not confirm deletion while holding ${key}`, () => {
      const fixture = setup()
      try {
        expect(fixture.press(key).defaultPrevented).toBe(true)
        expect(fixture.deletion.pending()).toEqual({ projectId: "project", worktreeId: "wt" })
        for (let i = 0; i < 3; i++) fixture.press(key, true)
        expect(fixture.removed).toEqual([])
        expect(fixture.store.busy().has("wt")).toBe(false)
        expect(fixture.deletion.pending()).toEqual({ projectId: "project", worktreeId: "wt" })
        fixture.press(key)
        expect(fixture.removed).toEqual([["project", "wt"]])
        expect(fixture.store.busy().get("wt")?.reason).toBe("deleting")
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
