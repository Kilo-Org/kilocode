import { describe, expect, it } from "bun:test"
import { createSignal } from "solid-js"
import {
  createDocumentInspector,
  documentPath,
  type DocumentMessage,
  type DocumentTransport,
} from "../webview-ui/documents/state"

function setup() {
  const [project, setProject] = createSignal<string | undefined>("project-a")
  const [selection, setSelection] = createSignal<string | null>("wt-a")
  const [open, setOpen] = createSignal(false)
  const sent: Array<{ sessionId: string; file: string; contextKey: string }> = []
  const opened: Array<{ file: string; sessionId?: string; line?: number; column?: number }> = []
  const copied: Array<{ file: string; sessionId?: string }> = []
  const watched = new Set<(message: DocumentMessage) => void>()
  const transport: DocumentTransport = {
    send: (sessionId, file, contextKey) => sent.push({ sessionId, file, contextKey }),
    openFile: (file, sessionId, line, column) => {
      opened.push({ file, sessionId, line, column })
      return true
    },
    copyPath: (file, sessionId) => {
      copied.push({ file, sessionId })
      return true
    },
    onMessage: (handler) => {
      watched.add(handler)
      return () => {
        watched.delete(handler)
      }
    },
  }
  const inspector = createDocumentInspector(
    transport,
    selection,
    project,
    open,
    () => setOpen(true),
    () => setOpen(false),
  )
  return { inspector, project, setProject, selection, setSelection, open, setOpen, sent, opened, copied, watched }
}

describe("document inspector", () => {
  it("opens a document tab and requests the file for its worktree", () => {
    const state = setup()
    expect(state.inspector.available()).toBe(false)

    expect(state.inspector.open("README.md", "ses-1", 4)).toBe(true)

    expect(state.inspector.available()).toBe(true)
    expect(state.inspector.isOpen()).toBe(true)
    expect(state.inspector.documents.tabs().map((tab) => tab.file)).toEqual(["README.md"])
    expect(state.sent).toEqual([
      { sessionId: "ses-1", file: "README.md", contextKey: "project-a:wt-a" },
    ])
  })

  it("keeps tabs per worktree and hides the button on a worktree without documents", () => {
    const state = setup()
    state.inspector.open("README.md", "ses-1")

    state.setOpen(false)
    state.setSelection("wt-b")
    expect(state.inspector.documents.tabs()).toEqual([])
    expect(state.inspector.available()).toBe(false)

    state.setSelection("wt-a")
    expect(state.inspector.documents.tabs().map((tab) => tab.file)).toEqual(["README.md"])
    expect(state.inspector.available()).toBe(true)
  })

  it("keeps tabs per project for the same worktree id", () => {
    const state = setup()
    state.inspector.open("README.md", "ses-1")

    state.setProject("project-b")
    expect(state.inspector.documents.tabs()).toEqual([])

    state.setProject("project-a")
    expect(state.inspector.documents.tabs().map((tab) => tab.file)).toEqual(["README.md"])
  })

  it("stores the canonical path from the host without losing the requested tab", () => {
    const state = setup()
    state.inspector.subscribe((message) => state.inspector.documents.onMessage(message))
    state.inspector.open("/abs/README.md", "ses-1")
    const handler = [...state.watched][0]
    handler?.({
      type: "agentManager.document",
      sessionId: "ses-1",
      contextKey: "project-a:wt-a",
      file: "README.md",
      requestedFile: "/abs/README.md",
      kind: "text",
      content: "# Read me",
    })

    expect(state.inspector.documents.document("/abs/README.md")).toEqual({
      file: "README.md",
      content: "# Read me",
      kind: "text",
      mime: undefined,
      data: undefined,
      error: undefined,
      loading: false,
    })
  })

  it("toggles the panel and opens a document from a file reference", () => {
    const state = setup()
    state.inspector.open(undefined)
    expect(state.open()).toBe(true)
    state.inspector.toggle()
    expect(state.open()).toBe(false)
    expect(state.inspector.available()).toBe(false)
  })

  it("posts copyFilePath and openFile requests scoped to the active session", () => {
    const state = setup()
    state.inspector.open("README.md", "ses-1")

    expect(state.inspector.copyPath("src/index.ts")).toBe(true)
    expect(state.copied).toEqual([{ file: "src/index.ts", sessionId: "wt-a" }])

    expect(state.inspector.openFile("src/index.ts", 4, 2)).toBe(true)
    expect(state.opened).toEqual([{ file: "src/index.ts", sessionId: "wt-a", line: 4, column: 2 }])
  })

  it("does not post copyFilePath or openFile requests without an active session", () => {
    const state = setup()
    state.setSelection(null)

    expect(state.inspector.copyPath("src/index.ts")).toBe(false)
    expect(state.inspector.openFile("src/index.ts")).toBe(false)
    expect(state.copied).toEqual([])
    expect(state.opened).toEqual([])
  })

  it("keeps content and comments scoped when switching worktrees and projects", () => {
    const state = setup()
    state.inspector.subscribe((message) => state.inspector.documents.onMessage(message))
    state.inspector.open("plans/plan.md", "ses-a")
    const handler = [...state.watched][0]
    handler?.({
      type: "agentManager.document",
      sessionId: "ses-a",
      contextKey: "project-a:wt-a",
      requestedFile: "plans/plan.md",
      file: "plans/plan.md",
      kind: "text",
      content: "# Worktree A",
    })
    state.inspector.comments.setComments([{ id: "a", file: "plans/plan.md", side: "additions", line: 1, comment: "A", selectedText: "" }])

    state.setOpen(false)
    state.setSelection("wt-b")
    expect(state.inspector.documents.tabs()).toEqual([])
    expect(state.inspector.documents.document("plans/plan.md")).toBeUndefined()
    expect(state.inspector.comments.comments()).toEqual([])

    state.setSelection("wt-a")
    expect(state.inspector.documents.tabs()).toHaveLength(1)
    expect(state.inspector.documents.document("plans/plan.md")?.content).toBe("# Worktree A")
    expect(state.inspector.comments.comments().map((item) => item.comment)).toEqual(["A"])

    state.setProject("project-b")
    expect(state.inspector.documents.tabs()).toEqual([])
    expect(state.inspector.comments.comments()).toEqual([])
  })

  it("uses the canonical relative path for tabs opened with an absolute path", () => {
    const tab = { id: "wt:C:/repo/docs/file.md", file: "C:/repo/docs/file.md" }
    const data = { file: "docs/file.md", content: "# Hi", loading: false }
    expect(documentPath(tab, () => data)).toBe("docs/file.md")
    expect(documentPath(tab, () => undefined)).toBe(tab.file)
  })

  it("opens the selected document in the editor for its session", () => {
    const state = setup()
    state.inspector.open("README.md", "ses-1")

    expect(state.inspector.openFile("README.md", 3, 2)).toBe(true)
    expect(state.opened).toEqual([{ file: "README.md", sessionId: "wt-a", line: 3, column: 2 }])

    state.setSelection(null)
    expect(state.inspector.openFile("README.md")).toBe(false)
  })
})
