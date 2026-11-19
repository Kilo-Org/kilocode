import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { HostedAttachments } from "@opencode/schema/kilocode/hosted-attachments"
import type { PromptAttachment } from "../../../src/protocol"

/** The transcript preview and upload must refer to the same validated bytes. */
export function cloudImages(items: readonly PromptAttachment[]) {
  if (items.length > 5) throw new Error("Cloud accepts up to five attachments per message.")
  return items.map((item) => {
    const end = item.uri.indexOf(",")
    const header = item.uri.slice(0, end).match(/^data:(image\/(?:jpeg|png|gif|webp));base64$/)
    const image = { id: item.id, mime: header?.[1], base64: item.uri.slice(end + 1) }
    if (item.kind !== "image" || !HostedAttachments.isImage(image))
      throw new Error("Cloud requires a supported image of at most 20 MiB.")
    return { image, name: item.name, description: item.description }
  })
}

/** Stage one image per relay request. The plugin owns the upload grants; only opaque handles return. */
export async function stageCloudImages(
  api: OpenCodeClient,
  directory: string,
  scope: string,
  messageID: string,
  images: ReturnType<typeof cloudImages>,
  signal?: AbortSignal,
) {
  if (!images.length) return
  const handles: string[] = []
  for (const { image } of images) {
    const result = await api
      .rpc(KiloHostedRpc.Definition)
      .stageImage({ scope, messageID, image }, { location: { directory }, signal })
    handles.push(result.handle)
  }
  return handles
}
