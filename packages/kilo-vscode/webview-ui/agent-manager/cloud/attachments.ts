import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { HostedAttachments } from "@opencode/schema/kilocode/hosted-attachments"
import type { PromptAttachment } from "../../../src/protocol"

/** Stage one image per relay request. The plugin owns the upload grants; only opaque handles return. */
export async function stageCloudImages(
  api: OpenCodeClient,
  directory: string,
  scope: string,
  messageID: string,
  items: readonly PromptAttachment[] = [],
  signal?: AbortSignal,
) {
  if (!items.length) return
  if (items.length > 5) throw new Error("Cloud accepts up to five attachments per message.")
  const images = items.map((item) => {
    const end = item.uri.indexOf(",")
    const header = item.uri.slice(0, end).match(/^data:(image\/(?:jpeg|png|gif|webp));base64$/)
    const image = { id: item.id, mime: header?.[1], base64: item.uri.slice(end + 1) }
    if (item.kind !== "image" || !HostedAttachments.isImage(image))
      throw new Error("Cloud requires a supported image of at most 20 MiB.")
    return image
  })
  const handles: string[] = []
  for (const image of images) {
    const result = await api
      .rpc(KiloHostedRpc.Definition)
      .stageImage({ scope, messageID, image }, { location: { directory }, signal })
    handles.push(result.handle)
  }
  return handles
}
