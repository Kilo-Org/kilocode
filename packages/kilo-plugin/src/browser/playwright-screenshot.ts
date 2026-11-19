import type { Frame, Page } from "playwright-core"
import type { ContentBlock } from "./backend"
import { decode, encode, mask, type Box } from "./png"

/** Mask boxes for withheld frames, in CSS pixels of the screenshot. */
async function maskBoxes(page: Page, frames: Frame[], fullPage: boolean) {
  const scroll = fullPage
    ? await page.mainFrame().evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    : { x: 0, y: 0 }
  const boxes: Box[] = []
  for (const frame of frames) {
    const handle = await frame.frameElement().catch(() => null)
    if (!handle) throw new Error("a withheld frame could not be measured")
    const box = await handle.boundingBox().finally(() => handle.dispose())
    if (!box) continue // a frame with no box paints no pixels
    boxes.push({ x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height })
  }
  return boxes
}

/** Mask withheld frames in-place. `false` means the capture cannot be published. */
export async function maskScreenshot(
  page: Page | undefined,
  images: Extract<ContentBlock, { type: "image" }>[],
  frames: Frame[],
  args: Record<string, unknown>,
) {
  if (!images.length || !page || args.target !== undefined) return false
  const fullPage = args.fullPage === true
  try {
    const boxes = await maskBoxes(page, frames, fullPage)
    for (const image of images) {
      if (image.mimeType !== "image/png") return false
      image.data = encode(mask(decode(Buffer.from(image.data, "base64")), boxes)).toString("base64")
      image.mimeType = "image/png"
    }
    return true
  } catch {
    return false
  }
}

/** The capture file is gone; the masked image replaces its link. */
export function withoutScreenshotLink(text: string) {
  return text
    .split("\n")
    .filter((line) => !/^- \[Screenshot[^\]]*\]\(.+\)$/.test(line.trim()))
    .join("\n")
}
