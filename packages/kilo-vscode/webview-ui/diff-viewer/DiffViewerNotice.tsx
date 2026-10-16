import { Show, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"

interface Props {
  text?: string
  role: "alert" | "status"
}

/** Shared warning banner used by the inline and full-screen diff views. */
export const DiffViewerNotice: Component<Props> = (props) => (
  <Show when={props.text}>
    <div class="diff-viewer-notice" role={props.role}>
      <span class="diff-viewer-notice-icon">
        <Icon name="warning" size="small" />
      </span>
      <span class="diff-viewer-notice-text">{props.text}</span>
    </div>
  </Show>
)
