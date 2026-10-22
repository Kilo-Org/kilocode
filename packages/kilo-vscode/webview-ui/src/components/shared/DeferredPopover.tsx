import { createEffect, createSignal, onCleanup, splitProps, type ValidComponent } from "solid-js"
import { Popover as Base, type PopoverProps } from "@kilocode/kilo-ui/popover"

export type { PopoverProps } from "@kilocode/kilo-ui/popover"

export interface DeferredPopoverProps<T extends ValidComponent = "div"> extends PopoverProps<T> {
  deferDismiss?: boolean
}

export function DeferredPopover<T extends ValidComponent = "div">(props: DeferredPopoverProps<T>) {
  const [local, rest] = splitProps(props, ["open", "defaultOpen", "onOpenChange", "deferDismiss"])
  const [open, setOpen] = createSignal(local.defaultOpen ?? false)
  const [ready, setReady] = createSignal(true)
  const defer = () => local.deferDismiss ?? false

  const controlled = () => local.open !== undefined
  const opened = () => {
    if (controlled()) return local.open ?? false
    return open()
  }

  const change = (next: boolean) => {
    if (defer() && !next && !ready()) return
    if (local.onOpenChange) local.onOpenChange(next)
    if (controlled()) return
    setOpen(next)
  }

  createEffect(() => {
    if (!defer()) return
    if (!opened()) {
      setReady(true)
      return
    }

    setReady(false)

    const frame = {
      id: requestAnimationFrame(() => {
        frame.id = requestAnimationFrame(() => {
          frame.id = 0
          setReady(true)
        })
      }),
    }

    onCleanup(() => {
      setReady(true)
      if (frame.id) cancelAnimationFrame(frame.id)
    })
  })

  return <Base {...rest} open={opened()} onOpenChange={change} />
}
