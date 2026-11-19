import type { OpenCodeClient } from "@opencode/client"
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { ResizeHandle } from "@kilocode/kilo-ui/resize-handle"
import { clampPanelWidth, createPanelResize, maxPanelWidth, minPanelWidth } from "../side-panel-layout"
import type { ChatRoute } from "./route"
import { CloudReview } from "./review"
import { EditPreviewPanel } from "../EditPreviewPanel"
import type { CloudToolPreview, DiffPreferences } from "./tool-diff"
import { CloudTerminalPane } from "./terminal-pane"
import type { CloudShells } from "./shell-tabs"

/** Keep shells attached to the selected sandbox across agent switches. PTYs close when their workspace is left. */
export function CloudInspector(props: {
  api: OpenCodeClient
  route?: ChatRoute
  shells?: CloudShells
  visible?: "terminal" | "review" | "edit"
  edits: CloudToolPreview
  diffPreferences: DiffPreferences
  close: () => void
  closeShell: () => void
  children: JSX.Element
}) {
  let host!: HTMLDivElement
  const [available, setAvailable] = createSignal(800)
  const [preferred, setPreferred] = createSignal<number>()
  const size = () => clampPanelWidth(preferred(), available())
  const resize = createPanelResize(setPreferred, available)
  onMount(() => {
    const read = () => setAvailable(host.clientWidth)
    read()
    const observer = new ResizeObserver(read)
    observer.observe(host)
    onCleanup(() => observer.disconnect())
  })
  return (
    <div ref={host} class="am-detail-content" classList={{ "am-detail-split": !!props.visible }}>
      <div class="am-main-pane">
        <div class="am-chat-wrapper">{props.children}</div>
      </div>
      <Show when={props.shells || props.visible}>
        <div
          class="am-diff-resize"
          classList={{ "am-side-host-hidden": !props.visible }}
          inert={!props.visible}
          style={{ width: `${size()}px` }}
        >
          <Show when={props.visible}>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              min={minPanelWidth(available())}
              max={maxPanelWidth(available())}
              size={size()}
              onResize={resize}
            />
          </Show>
          <div class="am-diff-panel-wrapper">
            <Show when={props.shells} keyed>
              {(shells) => (
                <CloudTerminalPane
                  api={props.api}
                  shells={shells}
                  visible={props.visible === "terminal"}
                  close={props.closeShell}
                />
              )}
            </Show>
            <Show when={props.visible === "review" && props.route} keyed>
              {(route) => (
                <CloudReview
                  api={props.api}
                  route={route}
                  close={props.close}
                  diffPreferences={props.diffPreferences}
                />
              )}
            </Show>
            <Show when={props.visible === "edit" && props.edits.preview()}>
              <EditPreviewPanel state={props.edits} visible={() => true} />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
