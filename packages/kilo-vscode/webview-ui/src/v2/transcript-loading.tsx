import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createSignal, onCleanup, Show } from "solid-js"

/** Only announce a load that lasts long enough to notice. The transcript itself never waits on this timer. */
export function TranscriptLoading(props: { label: string }) {
  const [visible, setVisible] = createSignal(false)
  const timer = setTimeout(() => setVisible(true), 150)
  onCleanup(() => clearTimeout(timer))
  return (
    <Show when={visible()}>
      <div class="message-list-loading" role="status">
        <Spinner />
        <span>{props.label}</span>
      </div>
    </Show>
  )
}
