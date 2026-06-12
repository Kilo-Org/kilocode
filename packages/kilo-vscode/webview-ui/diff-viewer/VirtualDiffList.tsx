import { createMemo, Show, type Accessor, type JSX } from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"

interface VirtualDiffListProps<T> {
  context: string | undefined
  data: T[]
  scroll: HTMLElement | undefined
  keep: number[]
  onReady: (handle?: VirtualizerHandle) => void
  render: (item: T, index: Accessor<number>) => JSX.Element
}

export function VirtualDiffList<T>(props: VirtualDiffListProps<T>) {
  // Virtua caches dynamic measurements by index. A new review needs a fresh
  // store and scroll origin even when it happens to contain the same row count.
  const state = createMemo(() => {
    const scroll = props.scroll
    const context = props.context
    if (!scroll) return
    scroll.scrollTop = 0
    return { context, scroll }
  })

  return (
    <Show when={state()} keyed>
      {(state) => (
        <Virtualizer
          ref={props.onReady}
          data={props.data}
          scrollRef={state.scroll}
          keepMounted={props.keep}
          overscan={4}
          itemSize={420}
        >
          {props.render}
        </Virtualizer>
      )}
    </Show>
  )
}
