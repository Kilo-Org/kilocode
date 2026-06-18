import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { EditHistoryTracker } from "../../src/services/autocomplete/next-edit/editHistoryTracker"

type Doc = vscode.TextDocument & { setText(text: string): void }

function doc(path: string, initial: string): Doc {
  const state = { text: initial }
  return {
    uri: { fsPath: path, scheme: "file" },
    getText: () => state.text,
    setText: (text: string) => {
      state.text = text
    },
  } as unknown as Doc
}

function docs(...items: Doc[]): void {
  ;(vscode.workspace.textDocuments as unknown as Doc[]).splice(0, Infinity, ...items)
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => docs())

describe("EditHistoryTracker", () => {
  it("retains chronological edits across files for Mercury context", async () => {
    const a = doc("/workspace/a.ts", "const a = 1\n")
    const b = doc("/workspace/b.ts", "const b = 1\n")
    docs(a, b)
    const tracker = new EditHistoryTracker({ isFileAllowed: async () => true })

    await settle()
    a.setText("const a = 2\n")
    await tracker.flush(a)
    b.setText("const b = 2\n")
    await tracker.flush(b)

    const diffs = await tracker.getRecentDiffs()
    expect(diffs).toHaveLength(2)
    expect(diffs[0]).toContain("a.ts")
    expect(diffs[0]).toContain("+const a = 2")
    expect(diffs[1]).toContain("b.ts")
    expect(diffs[1]).toContain("+const b = 2")

    tracker.dispose()
  })

  it("does not retain edits when the access policy is missing at runtime", async () => {
    const a = doc("/workspace/a.ts", "const a = 1\n")
    docs(a)
    const tracker = new EditHistoryTracker({} as { isFileAllowed: (path: string) => Promise<boolean> })

    await settle()
    a.setText("const a = 2\n")
    await tracker.flush(a)

    expect(await tracker.getRecentDiffs()).toEqual([])
    tracker.dispose()
  })

  it("never returns edits from denied documents", async () => {
    const denied = new Set(["/workspace/.env"])
    const safe = doc("/workspace/app.ts", "const safe = 1\n")
    const secret = doc("/workspace/.env", "TOKEN=old\n")
    docs(safe, secret)
    const tracker = new EditHistoryTracker({ isFileAllowed: async (path) => !denied.has(path) })

    await settle()
    secret.setText("TOKEN=secret\n")
    await tracker.flush(secret)
    safe.setText("const safe = 2\n")
    await tracker.flush(safe)

    const diffs = await tracker.getRecentDiffs()
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toContain("app.ts")
    expect(diffs[0]).not.toContain("TOKEN=secret")

    denied.add("/workspace/app.ts")
    expect(await tracker.getRecentDiffs()).toEqual([])

    tracker.dispose()
  })
})
