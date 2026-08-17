/** @jsxImportSource solid-js */
import { Show, createSignal } from "solid-js"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { SectionHeading } from "./SectionHeading"

export function PRDescription(props: { body: string }) {
  const [open, setOpen] = createSignal(true)
  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading title="Description" open={open()} onToggle={() => setOpen((v) => !v)} />
        <Show when={open()}>
          <div class="am-pr-panel-description">
            <Markdown text={props.body} />
          </div>
        </Show>
      </div>
    </>
  )
}
