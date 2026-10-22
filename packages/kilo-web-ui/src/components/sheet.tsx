import { Show, splitProps, type ComponentProps, type JSX } from "solid-js"

export function Sheet(props: { open?: boolean; onOpenChange?: (open: boolean) => void; children?: JSX.Element }) {
  return <Show when={props.open ?? true}>{props.children}</Show>
}

export function SheetTrigger(props: ComponentProps<"button">) {
  return <button {...props} data-slot="sheet-trigger" />
}

export function SheetClose(props: ComponentProps<"button">) {
  return <button {...props} data-slot="sheet-close" />
}

export function SheetContent(
  props: ComponentProps<"aside"> & { side?: "top" | "right" | "bottom" | "left"; showCloseButton?: boolean },
) {
  const [local, rest] = splitProps(props, ["side", "showCloseButton", "class", "classList", "children"])
  return (
    <aside
      {...rest}
      data-slot="sheet-content"
      data-side={local.side ?? "right"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </aside>
  )
}

export function SheetHeader(props: ComponentProps<"div">) {
  return <div {...props} data-slot="sheet-header" />
}

export function SheetFooter(props: ComponentProps<"div">) {
  return <div {...props} data-slot="sheet-footer" />
}

export function SheetTitle(props: ComponentProps<"h2">) {
  return <h2 {...props} data-slot="sheet-title" />
}

export function SheetDescription(props: ComponentProps<"p">) {
  return <p {...props} data-slot="sheet-description" />
}
