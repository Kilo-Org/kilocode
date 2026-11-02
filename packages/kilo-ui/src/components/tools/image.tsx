import { For, Show, type Component } from "solid-js"
import type { ToolFileContent } from "@opencode/client"
import { useDialog } from "../../context/dialog"
import { BasicTool } from "../basic-tool"
import { ImagePreview } from "../image-preview"
import type { ToolProps } from "../message-part"
import { busy } from "../tool-utils"

const title = "Image"

function string(value: unknown) {
  return typeof value === "string" ? value : ""
}

export const ImageTool: Component<ToolProps> = (props) => {
  const dialog = useDialog()
  const images = () => props.attachments.filter((file) => file.mime.startsWith("image/"))
  const prompt = () => string(props.input.prompt)
  const path = () => string(props.metadata.path) || string(props.input.path)
  const model = () => string(props.metadata.model) || string(props.input.model)
  const sources = () =>
    Array.isArray(props.input.images) ? props.input.images.filter((item): item is string => typeof item === "string") : []
  const preview = (file: ToolFileContent) => {
    dialog.show(() => <ImagePreview src={file.uri} alt={file.name || prompt() || title} />)
  }
  return (
    <BasicTool
      {...props}
      icon="photo"
      defaultOpen={images().length > 0}
      trigger={{
        title,
        subtitle: prompt(),
        args: [model(), sources().length ? `${sources().length} sources` : ""].filter(Boolean),
      }}
    >
      <div data-component="image-tool">
        <Show
          when={busy(props.status)}
          fallback={
            <>
              <Show when={images().length}>
                <div data-slot="image-tool-images">
                  <For each={images()}>
                    {(file) => (
                      <button
                        type="button"
                        data-slot="image-tool-image"
                        onClick={() => preview(file)}
                        aria-label={file.name || prompt() || title}
                      >
                        <img
                          data-slot="image-tool-image-content"
                          src={file.uri}
                          alt={file.name || prompt() || title}
                          loading="lazy"
                          decoding="async"
                        />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={path()}>
                <div data-slot="image-tool-path">{path()}</div>
              </Show>
              <Show when={model()}>
                <div data-slot="image-tool-model">{model()}</div>
              </Show>
              <Show when={!images().length && path()}>
                <div data-slot="image-tool-note">
                  The image is generated in the background and saved with its format extension when the job finishes.
                </div>
              </Show>
            </>
          }
        >
          <div data-slot="image-tool-generating">Generating image...</div>
        </Show>
      </div>
    </BasicTool>
  )
}
