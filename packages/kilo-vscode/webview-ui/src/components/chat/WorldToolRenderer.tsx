import { Component, createMemo, For, Show } from "solid-js"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { ToolRegistry, type ToolProps } from "@kilocode/kilo-ui/message-part"
import { ImagePreview } from "@kilocode/kilo-ui/image-preview"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { Markdown } from "@kilocode/kilo-ui/markdown"

function WorldToolRenderer(props: ToolProps) {
  const dialog = useDialog()
  const i18n = useI18n()
  const images = createMemo(() => (props.attachments ?? []).filter((f) => f.mime.startsWith("image/") && f.url))
  const preview = (url: string, alt?: string) => dialog.show(() => <ImagePreview src={url} alt={alt} />)
  const title = createMemo(() => (typeof props.metadata?.title === "string" ? props.metadata.title : "World"))
  const subtitle = createMemo(() => {
    const meta = props.metadata
    if (!meta || typeof meta !== "object") return ""
    const actions = typeof meta["actions"] === "number" ? meta["actions"] : 0
    const ms = typeof meta["durationMs"] === "number" ? meta["durationMs"] : 0
    if (!actions) return ""
    return `${actions} action${actions === 1 ? "" : "s"} · ${ms}ms`
  })

  return (
    <>
      <BasicTool
        {...props}
        icon="glasses"
        trigger={{
          title: title(),
          subtitle: subtitle(),
          args: [],
        }}
      >
        <Show when={props.output}>
          {(output) => (
            <div data-component="tool-output" data-scrollable>
              <Markdown text={output()} />
            </div>
          )}
        </Show>
      </BasicTool>
      <Show when={images().length > 0}>
        <div data-slot="tool-read-images">
          <For each={images()}>
            {(file) => (
              <div data-slot="tool-read-image" onClick={() => preview(file.url, file.filename)}>
                <img
                  data-slot="tool-read-image-img"
                  src={file.url}
                  alt={file.filename ?? i18n.t("ui.message.attachment.alt")}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}

export function registerWorldTool() {
  ToolRegistry.register({
    name: "world",
    render: WorldToolRenderer as Component<ToolProps>,
  })
}
