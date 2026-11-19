import type { ToolFileContent } from "@opencode/client"
import { For, Show } from "solid-js"
import { useDialog } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { ImagePreview } from "./image-preview"

/** The images among a tool result's files as thumbnails that open full size: what the model received, shown to the user. */
export function ToolImages(props: { files: ToolFileContent[] }) {
  const i18n = useI18n()
  const dialog = useDialog()
  const images = () => props.files.filter((file) => file.mime.startsWith("image/"))
  return (
    <Show when={images().length}>
      <div data-slot="tool-images">
        <For each={images()}>
          {(file) => (
            <div
              data-slot="tool-image"
              onClick={() => dialog.show(() => <ImagePreview src={file.uri} alt={file.name ?? undefined} />)}
            >
              <img
                data-slot="tool-image-img"
                src={file.uri}
                alt={file.name ?? i18n.t("ui.message.attachment.alt")}
                loading="lazy"
                decoding="async"
              />
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
