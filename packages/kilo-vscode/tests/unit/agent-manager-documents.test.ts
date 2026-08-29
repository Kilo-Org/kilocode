import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  createDocumentComments,
  createDocuments,
  handleDocumentOpen,
  isMarkdownPath,
} from "../../webview-ui/documents/state"
import type { AgentManagerDocumentMessage } from "../../webview-ui/src/types/messages"

describe("Agent Manager document state", () => {
  it("keeps tabs, content, and comments scoped when switching worktrees and projects", () => {
    createRoot((dispose) => {
      const sent: unknown[] = []
      const vscode = { postMessage: (message: unknown) => sent.push(message) } as Parameters<typeof createDocuments>[0]
      const [scope, setScope] = createSignal("project-a:wt-a")
      const [session, setSession] = createSignal<string | null>("ses-a")
      const docs = createDocuments(vscode, scope, session)
      const comments = createDocumentComments(scope)

      docs.open("plans/plan.md")
      expect(sent[0]).toMatchObject({ sessionId: "ses-a", contextKey: "project-a:wt-a" })
      docs.onMessage({
        type: "agentManager.document",
        sessionId: "ses-a",
        contextKey: "project-a:wt-a",
        requestedFile: "plans/plan.md",
        file: "plans/plan.md",
        kind: "text",
        content: "# Worktree A",
      } satisfies AgentManagerDocumentMessage)
      comments.setComments([{ id: "a", file: "plans/plan.md", side: "additions", line: 1, comment: "A" }])

      setScope("project-a:wt-b")
      setSession("ses-b")
      expect(docs.tabs()).toEqual([])
      expect(docs.document("plans/plan.md")).toBeUndefined()
      expect(comments.comments()).toEqual([])

      docs.onMessage({
        type: "agentManager.document",
        sessionId: "ses-a",
        contextKey: "project-a:wt-a",
        requestedFile: "plans/late.md",
        file: "plans/late.md",
        kind: "text",
        content: "# Late A",
      } satisfies AgentManagerDocumentMessage)
      expect(docs.tabs()).toEqual([])
      expect(docs.document("plans/late.md")).toBeUndefined()

      docs.open("plans/plan.md")
      expect(sent[1]).toMatchObject({ sessionId: "ses-b", contextKey: "project-a:wt-b" })
      docs.onMessage({
        type: "agentManager.document",
        sessionId: "ses-b",
        contextKey: "project-a:wt-b",
        requestedFile: "plans/plan.md",
        file: "plans/plan.md",
        kind: "text",
        content: "# Worktree B",
      } satisfies AgentManagerDocumentMessage)
      comments.setComments([{ id: "b", file: "plans/plan.md", side: "additions", line: 1, comment: "B" }])

      setScope("project-a:wt-a")
      setSession("ses-a")
      expect(docs.tabs()).toHaveLength(1)
      expect(docs.document("plans/plan.md")?.content).toBe("# Worktree A")
      expect(comments.comments().map((item) => item.comment)).toEqual(["A"])

      setScope("project-b:wt-a")
      expect(docs.tabs()).toEqual([])
      expect(comments.comments()).toEqual([])
      dispose()
    })
  })

  it("keeps Markdown in the document inspector and opens source files in VS Code", () => {
    expect(isMarkdownPath(".kilo/plans/feature.md")).toBe(true)
    expect(isMarkdownPath("docs/architecture.MDX")).toBe(true)
    expect(isMarkdownPath("src/index.ts")).toBe(false)

    const opened: unknown[] = []
    const native: unknown[] = []
    const markdown = new CustomEvent("kilo:open-file", {
      cancelable: true,
      detail: { filePath: ".kilo/plans/feature.md", sessionID: "wt-a", line: 4, column: 2 },
    })
    handleDocumentOpen(markdown, (...args) => {
      opened.push(args)
      return true
    })
    expect(markdown.defaultPrevented).toBe(true)
    expect(opened).toEqual([[".kilo/plans/feature.md", "wt-a", 4, 2]])

    const source = new CustomEvent("kilo:open-file", {
      cancelable: true,
      detail: { filePath: "src/index.ts", sessionID: "wt-a", line: 8, column: 3 },
    })
    handleDocumentOpen(
      source,
      () => false,
      (...args) => native.push(args),
    )
    expect(source.defaultPrevented).toBe(true)
    expect(native).toEqual([["src/index.ts", 8, 3, "wt-a"]])

    const missing = new CustomEvent("kilo:open-file", {
      cancelable: true,
      detail: { filePath: "src/missing.ts" },
    })
    handleDocumentOpen(
      missing,
      () => false,
      () => false,
    )
    expect(missing.defaultPrevented).toBe(false)
  })
})
