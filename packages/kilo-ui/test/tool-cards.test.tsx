import { afterEach, beforeEach, expect, test } from "bun:test"
import type { ToolActionDiff } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { editedFile, patchedFiles, unchangedFile, writtenFile } from "./fixtures"
import { mountRich, mountTool, trigger, waitFor, type Mounted } from "./harness"
import { ContentPart } from "../src/components/message-part"

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

function openDiff() {
  const calls: ToolActionDiff[] = []
  return { calls, action: (diff: ToolActionDiff) => calls.push(diff) }
}

test("edit card renders the file header, change counts and the real diff body", async () => {
  const diff = openDiff()
  const card = mountTool("edit", {
    input: { path: "src/math.ts" },
    metadata: { files: [editedFile] },
    partID: "edit-card",
    directory: "/repo",
    actions: { openDiff: diff.action },
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-component="edit-content"] [data-component="file"]'))

  expect(card.host.querySelector('[data-component="edit-tool"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="message-part-title-text"]')?.textContent).toBe("Edit")
  expect(card.host.querySelector('[data-slot="message-part-title-filename"]')?.textContent).toBe("math.ts")
  expect(card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent).toBe("+1")
  expect(card.host.querySelector('[data-slot="diff-changes-deletions"]')?.textContent).toBe("-0")
  expect(card.host.querySelector('[data-component="edit-content"] [data-component="file"]')).not.toBeNull()

  const action = card.host.querySelector<HTMLElement>('[aria-label="ui.messagePart.openInDiffViewer"]')
  action?.click()

  expect(diff.calls).toHaveLength(1)
  expect(diff.calls[0]).toMatchObject({ file: "src/math.ts", additions: 1, deletions: 0 })
  expect(diff.calls[0]?.patch).toContain("+export const NAME")
})

test("write card renders the written file and its diff", async () => {
  const card = mountTool("write", {
    input: { path: "src/notes.md", content: "# Notes\nFixture content.\n" },
    metadata: { files: [writtenFile] },
    partID: "write-card",
    directory: "/repo",
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-component="write-content"] [data-component="file"]'))

  expect(card.host.querySelector('[data-component="write-tool"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="message-part-title-text"]')?.textContent).toBe("Write")
  expect(card.host.querySelector('[data-slot="message-part-title-filename"]')?.textContent).toBe("notes.md")
  expect(card.host.querySelector('[data-component="write-content"] [data-component="file"]')).not.toBeNull()
})

test("read, edit and write cards open their file from the header action", async () => {
  const opened: string[] = []
  const action = (path: string) => opened.push(path)

  const read = mountTool("read", {
    input: { path: "README.md" },
    partID: "read-open",
    directory: "/repo",
    actions: { openFile: action },
  })
  mounted.push(read)
  const readButton = await waitFor(() =>
    read.host.querySelector<HTMLElement>('[aria-label="ui.messagePart.openInEditor"]'),
  )
  readButton.click()

  const edit = mountTool("edit", {
    input: { path: "src/math.ts" },
    metadata: { files: [editedFile] },
    partID: "edit-open",
    directory: "/repo",
    actions: { openFile: action },
  })
  mounted.push(edit)
  const editButton = await waitFor(() =>
    edit.host.querySelector<HTMLElement>('[aria-label="ui.messagePart.openInEditor"]'),
  )
  editButton.click()

  const write = mountTool("write", {
    input: { path: "src/notes.md", content: "# Notes\n" },
    metadata: { files: [writtenFile] },
    partID: "write-open",
    directory: "/repo",
    actions: { openFile: action },
  })
  mounted.push(write)
  const writeButton = await waitFor(() =>
    write.host.querySelector<HTMLElement>('[aria-label="ui.messagePart.openInEditor"]'),
  )
  writeButton.click()

  expect(opened).toEqual(["README.md", "src/math.ts", "src/notes.md"])
})

test("clicking a patch file name opens that file", async () => {
  const opened: string[] = []
  const card = mountTool("patch", {
    input: { patchText: editedFile.patch },
    metadata: { files: [editedFile] },
    partID: "patch-open",
    directory: "/repo",
    actions: { openFile: (path: string) => opened.push(path) },
    forceOpen: true,
  })
  mounted.push(card)
  const name = await waitFor(() => card.host.querySelector<HTMLElement>('[data-slot="message-part-title-filename"]'))
  name.click()

  expect(opened).toEqual(["src/math.ts"])
})

test("an unchanged write hides its details", async () => {
  const card = mountTool("write", {
    input: { path: "src/notes.md", content: "# Notes\nFixture content.\n" },
    metadata: { files: [unchangedFile] },
    partID: "write-unchanged",
    directory: "/repo",
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(
    () => card.host.querySelector('[data-component="tool-trigger"]')?.getAttribute("data-hide-details") === "true",
  )

  expect(card.host.querySelector('[data-component="write-content"]')).toBeNull()
  expect(card.host.querySelector('[data-component="tool-trigger"]')?.getAttribute("data-hide-details")).toBe("true")
})

test("patch card renders a single file with its diff", async () => {
  const card = mountTool("patch", {
    input: { patchText: editedFile.patch },
    metadata: { files: [editedFile] },
    partID: "patch-single",
    directory: "/repo",
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-component="apply-patch-file-diff"] [data-component="file"]'))

  expect(card.host.querySelector('[data-component="apply-patch-tool"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="message-part-title-text"]')?.textContent).toBe("Patch")
  expect(card.host.querySelector('[data-slot="apply-patch-filename"]')?.textContent).toBe("math.ts")
  expect(card.host.querySelector('[data-component="apply-patch-file-diff"] [data-component="file"]')).not.toBeNull()
})

test("patch card lists every file in a multi-file patch", async () => {
  const card = mountTool("patch", {
    input: { patchText: patchedFiles.map((file) => file.patch).join("") },
    metadata: { files: patchedFiles },
    partID: "patch-multi",
    directory: "/repo",
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelectorAll('[data-slot="apply-patch-filename"]').length === 2)

  const names = [...card.host.querySelectorAll('[data-slot="apply-patch-filename"]')].map((node) => node.textContent)
  expect(names).toEqual(["math.ts", "legacy.ts"])
  expect(card.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toContain("2 files")
  expect(card.host.querySelector('[data-slot="apply-patch-change"][data-type="removed"]')).not.toBeNull()
})

for (const [name, input] of [
  ["grep", { pattern: "marker", path: "src" }],
  ["glob", { pattern: "**/*.ts", path: "src" }],
] as const) {
  test(`${name} card defers its output body until the card expands`, async () => {
    const card = mountTool(name, { input, output: "src/a.ts:1: marker", partID: `${name}-defer` })
    mounted.push(card)

    expect(card.host.querySelector('[data-component="tool-output"]')).toBeNull()

    trigger(card.host).click()
    expect(card.host.querySelector('[data-component="tool-output"]')).toBeNull()

    const output = await waitFor(() => card.host.querySelector('[data-component="tool-output"]'))
    expect(output.textContent).toContain("marker")
  })
}

test("a deferred tool card opened by default mounts its output", async () => {
  const card = mountTool("grep", {
    input: { pattern: "marker", path: "src" },
    output: "src/a.ts:1: marker",
    partID: "grep-default-open",
    defaultOpen: true,
  })
  mounted.push(card)

  const output = await waitFor(() => card.host.querySelector('[data-component="tool-output"]'))
  expect(output.textContent).toContain("marker")
})

test("a deferred MCP card opened by a display layout mounts its body", async () => {
  const message = {
    id: "mcp-message",
    type: "assistant" as const,
    time: { created: 1 },
    agent: "default",
    model: { id: "test", providerID: "test" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    content: [],
  }
  const item = {
    type: "tool" as const,
    id: "mcp-default-open",
    name: "sample_docs_lookup",
    state: {
      status: "completed" as const,
      input: { query: "marker" },
      content: [{ type: "text" as const, text: "result" }],
      metadata: {},
    },
    time: { created: 1 },
  }
  const card = mountRich(() => <ContentPart item={item} message={message} index={0} defaultOpen />)
  mounted.push(card)

  const body = await waitFor(() => card.host.querySelector('[data-slot="mcp-section-label"]'))
  expect(body).not.toBeNull()
})
