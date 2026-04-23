import { Popover as Kobalte } from "@kobalte/core/popover"
import {
  ComponentProps,
  JSXElement,
  ParentProps,
  Show,
  createEffect,
  onCleanup,
  splitProps,
  ValidComponent,
} from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

export interface PopoverProps<T extends ValidComponent = "div">
  extends ParentProps,
    Omit<ComponentProps<typeof Kobalte>, "children"> {
  trigger?: JSXElement
  triggerAs?: T
  triggerProps?: ComponentProps<T>
  title?: JSXElement
  description?: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  style?: ComponentProps<"div">["style"]
  portal?: boolean
}

export function Popover<T extends ValidComponent = "div">(props: PopoverProps<T>) {
  const i18n = useI18n()
  const [local, rest] = splitProps(props, [
    "trigger",
    "triggerAs",
    "triggerProps",
    "title",
    "description",
    "class",
    "classList",
    "style",
    "children",
    "portal",
    "open",
    "defaultOpen",
    "onOpenChange",
    "modal",
  ])

  const [state, setState] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    triggerRef: undefined as HTMLElement | undefined,
    dismiss: null as "escape" | "outside" | null,
    uncontrolledOpen: local.defaultOpen ?? false,
    ready: true, // kilocode_change
  })

  const controlled = () => local.open !== undefined
  const opened = () => {
    if (controlled()) return local.open ?? false
    return state.uncontrolledOpen
  }

  const focus = (node?: ParentNode | null) => {
    const root = node ?? state.contentRef
    if (!root) return
    const target = root.querySelector<HTMLElement>("[data-autofocus]")
    if (!target) return
    target.focus()
  }

  const onOpenChange = (next: boolean) => {
    if (next) setState("dismiss", null)
    if (local.onOpenChange) local.onOpenChange(next)
    if (controlled()) return
    setState("uncontrolledOpen", next)
  }

  createEffect(() => {
    if (!opened()) return
    setState("ready", false)

    const inside = (node: Node | null | undefined) => {
      if (!node) return false
      const content = state.contentRef
      if (content && content.contains(node)) return true
      const trigger = state.triggerRef
      if (trigger && trigger.contains(node)) return true
      return false
    }

    const close = (reason: "escape" | "outside") => {
      setState("dismiss", reason)
      onOpenChange(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close("escape")
      event.preventDefault()
      event.stopPropagation()
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (inside(target)) return
      // Node was detached by a reactive update — treat as inside
      if (!target.isConnected) return
      close("outside")
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (inside(target)) return
      // Node was detached by a reactive update — treat as inside
      if (!target.isConnected) return
      close("outside")
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
    makeEventListener(window, "pointerdown", onPointerDown, { capture: true })
    makeEventListener(window, "focusin", onFocusIn, { capture: true })
  })

  createEffect(() => {
    if (!opened()) return
    const node = state.contentRef
    if (!node) return
    const id = requestAnimationFrame(() => focus(node))
    onCleanup(() => cancelAnimationFrame(id))
  })

  const content = () => (
    <Kobalte.Content
      ref={(el: HTMLElement | undefined) => setState("contentRef", el)}
      data-component="popover-content"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      style={local.style}
      onInteractOutside={(event: Event) => {
        // Custom window-level handlers manage outside dismissal;
        // always prevent Kobalte's built-in interact-outside close
        // to avoid double-firing and stale-node false positives.
        event.preventDefault()
      }}
      onFocusOutside={(event: Event) => {
        event.preventDefault()
      }}
      onOpenAutoFocus={(event: Event) => {
        const node = event.currentTarget as ParentNode | null
        if (!node) return
        event.preventDefault()
        focus(node)
      }}
      onCloseAutoFocus={(event: Event) => {
        if (state.dismiss === "outside") event.preventDefault()
        setState("dismiss", null)
      }}
    >
      {/* <Kobalte.Arrow data-slot="popover-arrow" /> */}
      <Show when={local.title}>
        <div data-slot="popover-header">
          <Kobalte.Title data-slot="popover-title">{local.title}</Kobalte.Title>
          <Kobalte.CloseButton
            data-slot="popover-close-button"
            as={IconButton}
            icon="close"
            variant="ghost"
            aria-label={i18n.t("ui.common.close")}
          />
        </div>
      </Show>
      <Show when={local.description}>
        <Kobalte.Description data-slot="popover-description">{local.description}</Kobalte.Description>
      </Show>
      <div data-slot="popover-body">{local.children}</div>
    </Kobalte.Content>
  )

  return (
    <Kobalte gutter={4} {...rest} open={opened()} onOpenChange={onOpenChange} modal={local.modal ?? false}>
      <Kobalte.Trigger
        ref={(el: HTMLElement) => setState("triggerRef", el)}
        as={local.triggerAs ?? "div"}
        data-slot="popover-trigger"
        {...(local.triggerProps as any)}
      >
        {local.trigger}
      </Kobalte.Trigger>
      <Show when={local.portal ?? true} fallback={content()}>
        <Kobalte.Portal>{content()}</Kobalte.Portal>
      </Show>
    </Kobalte>
  )
}
