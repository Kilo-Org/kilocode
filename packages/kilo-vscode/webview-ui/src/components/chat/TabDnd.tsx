declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

import { createSortable, useDragDropContext, type Transformer } from "@thisbeyond/solid-dnd"
import { Show, createEffect, createRoot, createSignal, onCleanup, onMount, type Component, type ParentComponent } from "solid-js"
import { promptMentionDragging, outsideTabBar } from "../../utils/prompt-mention-drop"

export { outsideTabBar }

/**
 * Keep tab drags in the tab bar normally, but allow a session tab to move down
 * out of the bar while it is being dragged to the prompt.
 */
export const ConstrainDragYAxis: Component = () => {
  const context = useDragDropContext()
  if (!context) return null
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer: Transformer = {
    id: "constrain-y-axis",
    order: 100,
    callback: (value) => ({ ...value, y: promptMentionDragging() ? Math.max(0, value.y) : 0 }),
  }
  const dispose = createRoot((cleanup) => {
    onDragStart(({ draggable }) => {
      if (draggable) addTransformer("draggables", draggable.id as string, transformer)
    })
    onDragEnd(({ draggable }) => {
      if (draggable) removeTransformer("draggables", draggable.id as string, transformer.id)
    })
    return cleanup
  })
  onCleanup(dispose)
  return null
}

/**
 * Attaches solid-dnd's `createSortable` to an already-mounted tab element.
 * Mounted one frame after the tab appears so `elementLayout()` (which calls
 * `getBoundingClientRect()` + `getComputedStyle()`) never forces a synchronous
 * style/layout flush mid-click when switching worktrees.
 */
const SortableBinding: Component<{
  id: string
  el: () => HTMLDivElement | undefined
  onDragging: (active: boolean) => void
}> = (props) => {
  const sortable = createSortable(props.id)
  const target = props.el()
  if (target) sortable(target)
  createEffect(() => props.onDragging(sortable.isActiveDraggable))
  onCleanup(() => props.onDragging(false))
  return null
}

export const SortableTabContainer: ParentComponent<{ id: string; class?: string }> = (props) => {
  let el: HTMLDivElement | undefined
  const [ready, setReady] = createSignal(false)
  const [dragging, setDragging] = createSignal(false)
  let frame: number | undefined

  onMount(() => {
    if (typeof requestAnimationFrame !== "function") {
      setReady(true)
      return
    }
    frame = requestAnimationFrame(() => {
      frame = undefined
      setReady(true)
    })
  })
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <div
      ref={el}
      class={props.class ?? "am-tab-sortable"}
      classList={{ "am-tab-dragging": dragging() }}
      data-tab-id={props.id}
    >
      {props.children}
      <Show when={ready()}>
        <SortableBinding id={props.id} el={() => el} onDragging={setDragging} />
      </Show>
    </div>
  )
}
