import { Show, type Accessor, type JSX } from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"

interface VirtualDiffListProps<T> {
  data: T[]
  scroll: HTMLElement | undefined
  keep: number[]
  onReady: (handle?: VirtualizerHandle) => void
  render: (item: T, index: Accessor<number>) => JSX.Element
}

export function VirtualDiffList<T>(props: VirtualDiffListProps<T>) {
  return (
    <Show when={props.scroll}>
      {(scroll) => (
        <Virtualizer
          ref={props.onReady}
          data={props.data}
          scrollRef={scroll()}
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
