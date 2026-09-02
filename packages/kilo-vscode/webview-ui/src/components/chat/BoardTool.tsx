import { createMemo, createSignal, For, Show } from "solid-js"
import { BasicTool, initialOpen } from "@kilocode/kilo-ui/basic-tool"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import type { ToolProps } from "@kilocode/kilo-ui/message-part"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { useSession } from "../../context/session"
import { board, presentation } from "./board-tool"

export function BoardTool(props: ToolProps) {
  const i18n = useI18n()
  const dialog = useDialog()
  const session = useSession()
  const state = createMemo(() => board(props.tool, props.input, props.output))
  const view = createMemo(() =>
    presentation(props.tool, state(), props.status === "completed", i18n.t, session.sessionInfo),
  )
  const [open, setOpen] = createSignal(
    initialOpen({
      tool: props.tool,
      partID: props.partID,
      callID: props.callID,
      defaultOpen: props.defaultOpen ?? false,
      forceOpen: props.forceOpen,
    }),
  )
  const [expanded, setExpanded] = createSignal(false)
  const all = () => expanded() || props.forceOpen
  const shown = createMemo(() => (all() ? view().messages : view().messages.slice(0, 3)))
  const inspect = () =>
    dialog.show(() => (
      <Dialog title={i18n.t("tool.board.details")} description={props.tool} fit>
        <pre data-slot="board-inspection" data-scrollable>
          {props.output ?? JSON.stringify(props.input, null, 2)}
        </pre>
      </Dialog>
    ))

  return (
    <BasicTool
      {...props}
      icon="speech-bubble"
      trigger={{ title: view().title, subtitle: view().subtitle }}
      defaultOpen={props.defaultOpen ?? false}
      onOpenChange={setOpen}
      allowPendingToggle
    >
      <Show when={open() || props.forceOpen}>
        <div data-component="board-tool">
          {"\n"}
          <div data-slot="board-messages" data-scrollable>
            <For each={shown()}>
              {(item) => (
                <div data-slot="board-message">
                  <div data-slot="board-message-meta">
                    <Show when={item.from}>
                      {(from) => <span title={view().from(from())}>{view().from(from())}</span>}
                    </Show>{" "}
                    <Show when={item.to}>{(to) => <span title={view().to(to())}>{view().to(to())}</span>}</Show>
                  </div>
                  {"\n"}
                  <p data-slot="board-body">{item.body}</p>
                  {"\n"}
                </div>
              )}
            </For>
            <Show when={view().unavailable}>
              {(text) => (
                <p data-slot="board-empty">
                  {text()}
                  {"\n"}
                </p>
              )}
            </Show>
            <Show when={view().empty}>
              {(empty) => (
                <p data-slot="board-empty">
                  {empty()}
                  {"\n"}
                </p>
              )}
            </Show>
          </div>
          <Show when={view().status || view().receipt}>
            <div data-slot="board-status">
              <Show when={view().status}>
                {(status) => (
                  <span>
                    {status()}
                    {"\n"}
                  </span>
                )}
              </Show>
              <Show when={view().receipt}>
                {(receipt) => (
                  <span>
                    {receipt()}
                    {"\n"}
                  </span>
                )}
              </Show>
            </div>
          </Show>
          <div data-slot="board-actions" data-search-ignore>
            <Show when={view().messages.length > 3 && !props.forceOpen}>
              <Button variant="ghost" size="small" aria-expanded={!!all()} onClick={() => setExpanded(!expanded())}>
                {all()
                  ? i18n.t("tool.board.showLess")
                  : i18n.t("tool.board.showMore", { count: view().messages.length - shown().length })}
              </Button>
            </Show>
            <Button variant="ghost" size="small" onClick={inspect}>
              {i18n.t("tool.board.details")}
            </Button>
          </div>
          <Show when={view().more}>
            {(more) => (
              <p data-slot="board-more">
                {"\n"}
                {more()}
              </p>
            )}
          </Show>
        </div>
      </Show>
    </BasicTool>
  )
}
