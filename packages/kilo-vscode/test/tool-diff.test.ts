import { afterEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { toolDiff } from "../src/tool-diff"
import type { ToolActionDiff } from "../src/protocol"

type Call = [string, ...unknown[]]

const original = vscode.commands.executeCommand
const calls: Call[] = []

function stub(failure?: Error) {
  calls.length = 0
  ;(vscode.commands as unknown as { executeCommand: (command: string, ...args: unknown[]) => Promise<unknown> }).executeCommand =
    async (command: string, ...args: unknown[]) => {
      calls.push([command, ...args])
      if (failure) throw failure
      return undefined
    }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  ;(vscode.commands as unknown as { executeCommand: unknown }).executeCommand = original
})

const combined = [
  "diff --git a/one b/one",
  "--- a/one",
  "+++ b/one",
  "@@ -1 +1 @@",
  "-a",
  "+b",
  "diff --git a/two b/two",
  "--- a/two",
  "+++ b/two",
  "@@ -1 +1 @@",
  "-c",
  "+d",
  "",
].join("\n")

describe("toolDiff", () => {
  test("opens one diff per file of a combined patch", async () => {
    stub()
    const diff = toolDiff()

    diff.openMany([{ file: "combined.patch", patch: combined, additions: 2, deletions: 2 }])
    await tick()

    expect(calls.map((call) => call[0])).toEqual(["vscode.diff", "vscode.diff"])
    expect(calls.map((call) => call[3])).toEqual(["Changes: one", "Changes: two"])
    // Each file stays open instead of replacing the previous preview tab.
    expect(calls.map((call) => call[4])).toEqual([{ preview: false }, { preview: false }])

    const left = calls[0]![1] as vscode.Uri
    const right = calls[0]![2] as vscode.Uri
    expect(diff.provider.provideTextDocumentContent(left, {} as never)).toBe("a\n")
    expect(diff.provider.provideTextDocumentContent(right, {} as never)).toBe("b\n")

    const leftTwo = calls[1]![1] as vscode.Uri
    expect(diff.provider.provideTextDocumentContent(leftTwo, {} as never)).toBe("c\n")
    diff.dispose()
  })

  test("keeps a single file a preview tab", async () => {
    stub()
    const diff = toolDiff()
    const single: ToolActionDiff = {
      file: "one",
      patch: ["--- a/one", "+++ b/one", "@@ -1 +1 @@", "-a", "+b", ""].join("\n"),
      additions: 1,
      deletions: 1,
    }

    diff.open(single)
    await tick()

    expect(calls).toHaveLength(1)
    expect(calls[0]![3]).toBe("Changes: one")
    expect(calls[0]![4]).toEqual({ preview: true })
    diff.dispose()
  })

  test("drops both virtual documents when the diff command rejects", async () => {
    stub(new Error("no diff editor"))
    const diff = toolDiff()
    const single: ToolActionDiff = {
      file: "one",
      patch: ["--- a/one", "+++ b/one", "@@ -1 +1 @@", "-a", "+b", ""].join("\n"),
      additions: 1,
      deletions: 1,
    }

    diff.open(single)
    await tick()

    const left = calls[0]![1] as vscode.Uri
    const right = calls[0]![2] as vscode.Uri
    expect(diff.provider.provideTextDocumentContent(left, {} as never)).toBe("")
    expect(diff.provider.provideTextDocumentContent(right, {} as never)).toBe("")
    diff.dispose()
  })

  test("opens every entry when several files are passed", async () => {
    stub()
    const diff = toolDiff()
    const entry = (file: string, before: string, after: string): ToolActionDiff => ({
      file,
      patch: [`--- a/${file}`, `+++ b/${file}`, "@@ -1 +1 @@", `-${before}`, `+${after}`, ""].join("\n"),
      additions: 1,
      deletions: 1,
    })

    diff.openMany([entry("one", "a", "b"), entry("two", "c", "d")])
    await tick()

    expect(calls.map((call) => call[3])).toEqual(["Changes: one", "Changes: two"])
    expect(calls.map((call) => call[4])).toEqual([{ preview: false }, { preview: false }])
    diff.dispose()
  })
})