import { Show, type Component } from "solid-js"
import type { ImageAttachment } from "../../hooks/useImageAttachments"

/** Thumbnail of a prompt attachment: the image itself, or the name of a dropped text file. */
export const AttachmentThumb: Component<{ file: ImageAttachment; onPreview: () => void }> = (props) => (
  <Show
    when={props.file.mime.startsWith("image/")}
    fallback={
      <div class="image-attachment-file" title={props.file.filename}>
        {props.file.filename}
      </div>
    }
  >
    <img src={props.file.dataUrl} alt={props.file.filename} title={props.file.filename} onClick={props.onPreview} />
  </Show>
)
