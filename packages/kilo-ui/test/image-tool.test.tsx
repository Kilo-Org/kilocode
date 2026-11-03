import { afterEach, beforeEach, expect, test } from "bun:test"
import type { ToolFileContent } from "@opencode/client"
import { File } from "../src/components/file"
import { ToolRegistry, type ToolProps } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { ImageTool } from "../src/components/tools/image"
import { DialogProvider } from "../src/context/dialog"
import { FileComponentProvider } from "../src/context/file"
import { mount, waitFor, type Mounted } from "./harness"

ToolRegistry.register({ name: "experimental_image_generate", render: ImageTool })

const defaults: ToolProps = {
  input: {},
  metadata: {},
  tool: "experimental_image_generate",
  partID: "image-part",
  output: "",
  status: "completed",
  attachments: [],
}

const attachment: ToolFileContent = {
  type: "file",
  uri: "data:image/png;base64,AAAA",
  mime: "image/png",
  name: "cat.png",
}

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
  document.querySelector("[data-component='dialog-stack']")?.remove()
})

function mountImage(props: Partial<ToolProps> = {}) {
  const card = mount(() => (
    <DialogProvider>
      <FileComponentProvider component={File}>
        <ImageTool {...defaults} {...props} />
      </FileComponentProvider>
    </DialogProvider>
  ))
  mounted.push(card)
  return card
}

test("image card shows the generated image, its prompt, path and model", async () => {
  const card = mountImage({
    input: { prompt: "A cat on a mat" },
    metadata: { path: "/repo/out/cat", model: "test/painter" },
    attachments: [attachment],
    forceOpen: true,
  })
  const image = await waitFor(() => card.host.querySelector<HTMLImageElement>('[data-slot="image-tool-image-content"]'))

  expect(card.host.querySelector('[data-component="image-tool"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="basic-tool-tool-title"]')?.textContent).toBe("Image")
  expect(card.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toBe("A cat on a mat")
  expect(image.getAttribute("src")).toBe(attachment.uri)
  expect(card.host.querySelector('[data-slot="image-tool-path"]')?.textContent).toBe("/repo/out/cat")
  expect(card.host.querySelector('[data-slot="image-tool-model"]')?.textContent).toBe("test/painter")
  expect(card.host.querySelector('[data-slot="image-tool-note"]')).toBeNull()
})

test("image card shows the saved path when the tool part has no image attachment", async () => {
  const card = mountImage({
    input: { prompt: "A cat on a mat" },
    metadata: { path: "/repo/out/cat", model: "test/painter" },
    forceOpen: true,
  })
  await waitFor(() => card.host.querySelector('[data-slot="image-tool-path"]'))

  expect(card.host.querySelector('[data-slot="image-tool-image-content"]')).toBeNull()
  expect(card.host.querySelector('[data-slot="image-tool-note"]')?.textContent).toContain("format extension")
})

test("an unnamed image without a prompt falls back to the card title", async () => {
  const card = mountImage({
    attachments: [{ type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png" }],
    forceOpen: true,
  })
  const button = await waitFor(() => card.host.querySelector<HTMLButtonElement>('[data-slot="image-tool-image"]'))

  expect(button.getAttribute("aria-label")).toBe("Image")
  expect(button.querySelector("img")?.getAttribute("alt")).toBe("Image")
})

test("a pending image call shows the generating state instead of a saved path", async () => {
  const card = mountImage({
    input: { prompt: "A cat on a mat" },
    metadata: { path: "/repo/out/cat", model: "test/painter" },
    status: "pending",
    forceOpen: true,
  })
  const state = await waitFor(() => card.host.querySelector('[data-slot="image-tool-generating"]'))

  expect(state.textContent).toBe("Generating image...")
  expect(card.host.querySelector('[data-slot="image-tool-path"]')).toBeNull()
  expect(card.host.querySelector('[data-slot="image-tool-note"]')).toBeNull()
  expect(card.host.querySelector('[data-slot="image-tool-image-content"]')).toBeNull()
})

test("clicking a generated image opens the image preview", async () => {
  const card = mountImage({
    input: { prompt: "A cat on a mat" },
    attachments: [attachment],
    forceOpen: true,
  })
  const button = await waitFor(() => card.host.querySelector<HTMLButtonElement>('[data-slot="image-tool-image"]'))
  button.click()

  const preview = await waitFor(() => document.querySelector('[data-component="image-preview"]'), 2000)
  expect(preview).not.toBeNull()
  expect(document.querySelector<HTMLImageElement>('[data-slot="image-preview-image"]')?.getAttribute("src")).toBe(
    attachment.uri,
  )
})

test("image card keeps the source count in the trigger", async () => {
  const card = mountImage({
    input: { prompt: "A cat on a mat", images: ["a.png", "b.png"] },
    forceOpen: true,
  })
  await waitFor(() => card.host.querySelector('[data-component="image-tool"]'))

  const args = [...card.host.querySelectorAll('[data-slot="basic-tool-tool-arg"]')].map((node) => node.textContent)
  expect(args).toContain("2 sources")
})
