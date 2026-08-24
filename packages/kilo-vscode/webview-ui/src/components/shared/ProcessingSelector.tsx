import { type Accessor, Component, createSignal, For, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { PopupSelector } from "./PopupSelector"
import type { ProcessingMode } from "../../types/messages"

interface ProcessingSelectorProps {
  sessionID?: Accessor<string | undefined>
}

const modes: ProcessingMode[] = ["standard", "flex"]

export const ProcessingSelector: Component<ProcessingSelectorProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const id = () => props.sessionID?.()
  const [open, setOpen] = createSignal(false)
  const [focused, setFocused] = createSignal(0)
  let listRef: HTMLDivElement | undefined

  function focusItem(index: number) {
    const items = listRef?.querySelectorAll<HTMLElement>("[role=option]")
    if (!items || items.length === 0) return
    const next = Math.max(0, Math.min(index, items.length - 1))
    setFocused(next)
    items[next]?.focus()
  }

  function onOpen(value: boolean) {
    if (value) {
      setFocused(Math.max(0, modes.indexOf(session.currentProcessingMode(id()))))
      setOpen(true)
      return
    }
    setOpen(false)
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
  }

  const onTrigger = (event: Event) => {
    if ((event as CustomEvent<{ source?: string }>).detail?.source !== "processing") return
    onOpen(true)
  }
  window.addEventListener("openProcessingPicker", onTrigger)
  onCleanup(() => window.removeEventListener("openProcessingPicker", onTrigger))

  function pick(mode: ProcessingMode) {
    session.selectProcessingMode(mode, id())
    onOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusItem((focused() + 1) % modes.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      focusItem((focused() - 1 + modes.length) % modes.length)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      focusItem(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      focusItem(modes.length - 1)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      pick(modes[focused()] ?? "standard")
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      onOpen(false)
    }
  }

  return (
    <Show when={session.supportsFlex(id())}>
      <Tooltip value={language.t("prompt.processing.tooltip")} placement="top" openDelay={0}>
        <PopupSelector
          expanded={false}
          placement="top-start"
          preferredWidth={240}
          minHeight={100}
          open={open()}
          onOpenChange={onOpen}
          triggerAs={Button}
          triggerProps={{
            variant: "ghost",
            size: "small",
            "aria-label": language.t("prompt.processing.label"),
          }}
          trigger={
            <>
              <span class="processing-selector-trigger-label">
                {language.t(`prompt.processing.${session.currentProcessingMode(id())}`)}
              </span>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ "flex-shrink": "0" }}>
                <path d="M8 4l4 5H4l4-5z" />
              </svg>
            </>
          }
        >
          {(bodyH) => (
            <div
              class="processing-selector-list"
              role="listbox"
              ref={listRef}
              onKeyDown={onKeyDown}
              style={bodyH() !== undefined ? { "max-height": `${bodyH()}px` } : {}}
            >
              <For each={modes}>
                {(mode, index) => (
                  <div
                    class={`processing-selector-item${session.currentProcessingMode(id()) === mode ? " selected" : ""}`}
                    role="option"
                    aria-selected={session.currentProcessingMode(id()) === mode}
                    tabindex={focused() === index() ? 0 : -1}
                    data-autofocus={focused() === index() ? "" : undefined}
                    onClick={() => pick(mode)}
                    onFocus={() => setFocused(index())}
                  >
                    <span class="processing-selector-item-name">{language.t(`prompt.processing.${mode}`)}</span>
                    <span class="processing-selector-item-description">
                      {language.t(`prompt.processing.${mode}.description`)}
                    </span>
                  </div>
                )}
              </For>
            </div>
          )}
        </PopupSelector>
      </Tooltip>
    </Show>
  )
}
