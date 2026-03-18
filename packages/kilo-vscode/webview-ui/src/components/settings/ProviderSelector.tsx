import { Button } from "@kilocode/kilo-ui/button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useLanguage } from "../../context/language"

export interface ProviderOption {
  value: string
  label: string
}

interface ProviderSelectorProps {
  options: ProviderOption[]
  value?: ProviderOption
  onSelect: (item: ProviderOption) => void
  placeholder?: string
  placement?: "top-start" | "bottom-start" | "bottom-end" | "top-end"
}

const ProviderSelector: Component<ProviderSelectorProps> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [activeIndex, setActiveIndex] = createSignal(0)

  let searchRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined

  const filtered = createMemo(() => {
    const query = search().trim().toLowerCase()
    if (!query) return props.options
    return props.options.filter((item) => {
      return item.label.toLowerCase().includes(query) || item.value.toLowerCase().includes(query)
    })
  })

  createEffect(() => {
    filtered()
    setActiveIndex(0)
  })

  createEffect(() => {
    if (open()) {
      requestAnimationFrame(() => searchRef?.focus())
      return
    }
    setSearch("")
  })

  function pick(item: ProviderOption) {
    props.onSelect(item)
    setOpen(false)
  }

  function scrollActiveIntoView() {
    requestAnimationFrame(() => {
      const el = listRef?.querySelector(".model-selector-item.active")
      el?.scrollIntoView({ block: "nearest" })
    })
  }

  function handleKeyDown(e: KeyboardEvent) {
    const items = filtered()
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (items.length === 0) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % items.length)
      scrollActiveIntoView()
      return
    }

    if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + items.length) % items.length)
      scrollActiveIntoView()
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      const item = items[activeIndex()]
      if (item) pick(item)
    }
  }

  const triggerLabel = () =>
    props.value?.label || props.placeholder || language.t("settings.providers.select.placeholder")

  return (
    <Popover
      placement={props.placement ?? "bottom-start"}
      open={open()}
      onOpenChange={setOpen}
      triggerAs={Button}
      triggerProps={{
        variant: "secondary",
        size: "normal",
        disabled: props.options.length === 0,
        title: props.value?.value,
        style: { width: "100%", "justify-content": "space-between" },
      }}
      trigger={
        <>
          <span class="model-selector-trigger-label">{triggerLabel()}</span>
          <svg class="model-selector-trigger-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4l4 5H4l4-5z" />
          </svg>
        </>
      }
      class="model-selector-popover"
    >
      <div onKeyDown={handleKeyDown}>
        <div class="model-selector-search-wrapper">
          <input
            ref={searchRef}
            class="model-selector-search"
            type="text"
            placeholder={language.t("settings.providers.search.placeholder")}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>

        <div class="model-selector-list" role="listbox" ref={listRef}>
          <Show when={filtered().length === 0}>
            <div class="model-selector-empty">{language.t("dialog.model.empty")}</div>
          </Show>

          <For each={filtered()}>
            {(item, index) => (
              <div
                class={`model-selector-item${index() === activeIndex() ? " active" : ""}${props.value?.value === item.value ? " selected" : ""}`}
                role="option"
                aria-selected={props.value?.value === item.value}
                onClick={() => pick(item)}
                onMouseEnter={() => setActiveIndex(index())}
              >
                <span class="model-selector-item-name">{item.label}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </Popover>
  )
}

export default ProviderSelector
