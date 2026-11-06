import { createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { VirtualDiffView, type VirtualDiffFile } from "../diff-viewer/VirtualDiffView"
import { useLanguage } from "../src/context/language"
import { getVSCodeAPI } from "../src/context/vscode"

type DiffStyle = "unified" | "split"

type DiffMessage = {
  type: string
  diff?: VirtualDiffFile
  initialDiffStyle?: DiffStyle
  markdownRender?: boolean
}

/** The virtual diff viewer of a tool call. The host pushes the files of the panel that asked for them. */
export const DiffVirtualApp: Component = () => {
  const { t } = useLanguage()
  const [diff, setDiff] = createSignal<VirtualDiffFile>()
  const [style, setStyle] = createSignal<DiffStyle>("unified")
  const [markdown, setMarkdown] = createSignal(false)

  const files = () => {
    const current = diff()
    if (!current) return []
    return current.files?.length ? current.files : [current]
  }

  const receive = (event: MessageEvent) => {
    const message = event.data as DiffMessage
    if (message?.type !== "diffVirtual.data" || !message.diff) return
    setDiff(message.diff)
    setStyle(message.initialDiffStyle ?? "unified")
    setMarkdown(message.markdownRender === true)
  }
  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))
  // The host sends the diff once this view can receive it.
  onMount(() => getVSCodeAPI().postMessage({ type: "webviewReady" } as never))

  return (
    <Show when={files().length > 0}>
      <div class="am-review-layout">
        <div class="am-review-toolbar">
          <div class="am-review-toolbar-left">
            <RadioGroup
              options={["unified", "split"] as const}
              current={style()}
              value={(value) => value}
              label={(value) =>
                value === "unified" ? t("ui.sessionReview.diffStyle.unified") : t("ui.sessionReview.diffStyle.split")
              }
              size="small"
              onSelect={(value) => {
                if (!value) return
                setStyle(value)
                getVSCodeAPI().postMessage({ type: "diffVirtual.setDiffStyle", style: value } as never)
              }}
            />
          </div>
        </div>
        <div class="am-edit-preview-files">
          <For each={files()}>
            {(file) => (
              <VirtualDiffView
                diff={file}
                diffStyle={style()}
                onDiffStyleChange={setStyle}
                markdownRender={markdown()}
                onMarkdownRenderChange={(render) => {
                  setMarkdown(render)
                  getVSCodeAPI().postMessage({ type: "diffVirtual.setMarkdownRender", render } as never)
                }}
                styleSelect={false}
              />
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
