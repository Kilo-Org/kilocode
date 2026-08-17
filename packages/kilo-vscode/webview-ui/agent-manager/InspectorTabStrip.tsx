import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { For, Show, createSignal, type Accessor, type Component, type JSX } from "solid-js"
import { ConstrainDragYAxis } from "../src/components/chat/TabDnd"
import { createTabFocus } from "../src/utils/tab-navigation"
import { useTabScroll } from "../src/utils/tab-scroll"
import { setTabWidths } from "../src/utils/tab-widths"

const TABLIST = ".am-inspector-tablist"

type InspectorTabFocus = ReturnType<typeof createTabFocus>

interface InspectorTabStripApi {
  focus: InspectorTabFocus
  freeze: () => void
  release: () => void
}

interface Props {
  ids: Accessor<readonly string[]>
  active: Accessor<string | undefined>
  label: string
  renderTab: (id: string, api: InspectorTabStripApi) => JSX.Element
  overlay: (id: string) => string
  onSelect: (id: string) => void
  onReorder: (from: string, to: string) => void
  action?: (api: InspectorTabStripApi) => JSX.Element
}

export const InspectorTabStrip: Component<Props> = (props) => {
  let host!: HTMLDivElement
  const scroll = useTabScroll(props.ids, props.active)
  const focus = createTabFocus({ ids: props.ids, select: props.onSelect, root: () => host })
  const [dragging, setDragging] = createSignal<{ id: string; width: number }>()
  const freeze = () => setTabWidths(true, host, TABLIST)
  const release = () => setTabWidths(false, host, TABLIST)
  const api = { focus, freeze, release }
  const start = (event: DragEvent) => {
    const id = event.draggable?.id
    if (typeof id !== "string") return
    const width = event.draggable?.layout.width ?? event.draggable?.node.getBoundingClientRect().width
    freeze()
    setDragging({ id, width })
  }
  const end = () => {
    setDragging(undefined)
    release()
  }
  const over = (event: DragEvent) => {
    const from = event.draggable?.id
    const to = event.droppable?.id
    if (typeof from !== "string" || typeof to !== "string") return
    props.onReorder(from, to)
  }

  return (
    <div
      ref={host}
      class="am-inspector-tabs"
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest(".am-tab-close[data-tab-close]")) freeze()
      }}
      onPointerLeave={() => {
        if (!dragging()) release()
      }}
    >
      <DragDropProvider onDragStart={start} onDragEnd={end} onDragOver={over} collisionDetector={closestCenter}>
        <DragDropSensors />
        <ConstrainDragYAxis />
        <div class="am-tab-scroll-area">
          <div class={`am-tab-fade am-tab-fade-left ${scroll.showLeft() ? "am-tab-fade-visible" : ""}`} />
          <div class="am-tab-list-wrap">
            <div
              class="am-inspector-tablist"
              ref={(el) => {
                scroll.setRef(el)
              }}
              role={props.ids().length > 0 ? "tablist" : undefined}
              aria-label={props.ids().length > 0 ? props.label : undefined}
              style={{ "--tab-count": `${props.ids().length}` } as JSX.CSSProperties}
            >
              <SortableProvider ids={[...props.ids()]}>
                <For each={props.ids()}>{(id) => props.renderTab(id, api)}</For>
              </SortableProvider>
            </div>
          </div>
          <div class={`am-tab-fade am-tab-fade-right ${scroll.showRight() ? "am-tab-fade-visible" : ""}`} />
        </div>
        <DragOverlay>
          <Show when={dragging()}>
            {(tab) => (
              <div class="am-tab am-tab-overlay" style={{ width: `${tab().width}px` }}>
                <span class="am-tab-label">{props.overlay(tab().id)}</span>
              </div>
            )}
          </Show>
        </DragOverlay>
      </DragDropProvider>
      {props.action?.(api)}
    </div>
  )
}
