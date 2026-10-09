import { describe, expect, it, mock } from "bun:test"
import { createRoot } from "solid-js"

// The toast and language modules are JSX, which Bun cannot load here. The hook
// uses them only to show a rejected file.
const toasts: Array<{ description?: string }> = []
mock.module("@kilocode/kilo-ui/toast", () => ({
  showToast: (toast: { description?: string }) => toasts.push(toast),
}))
mock.module("../../webview-ui/src/context/language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

const { useImageAttachments } = await import("../../webview-ui/src/hooks/useImageAttachments")

function setup() {
  toasts.length = 0
  const paths: string[][] = []
  const root = createRoot((dispose) => ({ dispose, attach: useImageAttachments() }))
  root.attach.setFilePathDropHandler((items) => paths.push(items))
  return { ...root, paths }
}

function drag(data: Record<string, string>, files: File[] = []) {
  const state = { prevented: false }
  const types = [...Object.keys(data), ...(files.length > 0 ? ["Files"] : [])]
  const event = {
    dataTransfer: { types, files, getData: (type: string) => data[type] ?? "" },
    preventDefault: () => {
      state.prevented = true
    },
  } as unknown as DragEvent
  return { event, state }
}

describe("useImageAttachments drag and drop", () => {
  it("accepts a drag that offers only text/uri-list and inserts the file URIs on drop", () => {
    const ctx = setup()
    const list = "# a comment\r\nfile:///repo/src/a.ts\r\nhttps://example.com/page\r\n"

    const over = drag({ "text/uri-list": list })
    ctx.attach.handleDragOver(over.event)
    expect(over.state.prevented).toBe(true)
    expect(ctx.attach.dragging()).toBe(true)

    const drop = drag({ "text/uri-list": list })
    ctx.attach.handleDrop(drop.event)
    expect(drop.state.prevented).toBe(true)
    expect(ctx.attach.dragging()).toBe(false)
    expect(ctx.paths).toEqual([["file:///repo/src/a.ts"]])
    expect(ctx.attach.images()).toEqual([])
    ctx.dispose()
  })

  it("does not accept a plain text drag", () => {
    const ctx = setup()
    const over = drag({ "text/plain": "hello" })
    ctx.attach.handleDragOver(over.event)
    expect(over.state.prevented).toBe(false)
    expect(ctx.attach.dragging()).toBe(false)
    ctx.dispose()
  })

  it("attaches a dropped text file and rejects a binary file", async () => {
    const ctx = setup()
    const notes = new File(["# Notes\n"], "notes.md", { type: "text/markdown" })
    const binary = new File([new Uint8Array([0x50, 0x4b, 0x00, 0x03])], "archive.zip")

    const drop = drag({}, [notes, binary])
    ctx.attach.handleDrop(drop.event)
    while (ctx.attach.pending()) await Bun.sleep(1)

    expect(ctx.paths).toEqual([])
    expect(ctx.attach.images().map((item) => [item.filename, item.mime, item.dataUrl])).toEqual([
      ["notes.md", "text/plain", `data:text/plain;base64,${btoa("# Notes\n")}`],
    ])
    expect(toasts.map((toast) => toast.description)).toEqual(["prompt.attachment.unsupported"])
    ctx.dispose()
  })

  it("splits images from dropped text files", () => {
    const ctx = setup()
    const image = { id: "a", filename: "shot.png", mime: "image/png", dataUrl: "data:image/png;base64,AA==" }
    const text = { id: "b", filename: "notes.md", mime: "text/plain", dataUrl: "data:text/plain;base64,AA==" }
    ctx.attach.replace([text, image])
    expect(ctx.attach.thumbs()).toEqual([image])
    expect(ctx.attach.texts()).toEqual([text])
    ctx.dispose()
  })
})
