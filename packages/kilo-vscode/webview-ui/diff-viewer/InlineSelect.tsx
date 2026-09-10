import { type Component, For, Show, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { DeferredPopover } from "../src/components/shared/DeferredPopover"

export interface InlineOption<T extends string> {
  value: T
  label: string
  /** Secondary text shown right-aligned in the menu row. */
  hint?: string
  /** Optional group heading; consecutive options sharing a group are grouped. */
  group?: string
}

interface InlineSelectProps<T extends string> {
  options: InlineOption<T>[]
  value: T | undefined
  onSelect: (value: T) => void
  /** Trigger icon. Omit to keep the trigger as narrow as possible. */
  icon?: string
  /** Accessible name / tooltip text for the trigger. */
  title: string
  /** Caps the trigger label width so long values ellipsize instead of pushing. */
  compact?: boolean
  /** Extra class on the trigger, so narrow-width rules can target one control. */
  class?: string
}

/**
 * Compact dropdown sized for a diff toolbar row.
 *
 * Deliberately not kilo-ui's `Select`: that renders an input-sized control
 * (32px, base font) which dwarfs the ghost buttons and radio group it sits
 * next to. This mirrors the `am-selector-trigger` markup the branch pickers
 * use, shrunk via `.diff-inline-trigger`, so every control in the row shares
 * one height and font size.
 */
export function InlineSelect<T extends string>(props: InlineSelectProps<T>) {
  const [open, setOpen] = createSignal(false)

  const current = () => props.options.find((opt) => opt.value === props.value)
  const label = () => current()?.label ?? ""

  const choose = (value: T) => {
    props.onSelect(value)
    setOpen(false)
  }

  // Group heading renders only when it differs from the previous option's, so
  // callers just order their options by group.
  const heading = (index: number) => {
    const group = props.options[index]?.group
    if (!group) return undefined
    if (index === 0) return group
    return props.options[index - 1]?.group === group ? undefined : group
  }

  return (
    <DeferredPopover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      flip
      portal={false}
      deferDismiss
      class="am-dropdown diff-inline-menu"
      trigger={
        <button
          class={`am-selector-trigger diff-inline-trigger${props.class ? ` ${props.class}` : ""}`}
          type="button"
          title={props.title}
        >
          <span class="am-selector-left">
            <Show when={props.icon}>{(name) => <Icon name={name()} size="small" />}</Show>
            <span class="am-selector-value">{label()}</span>
          </span>
          <span class="am-selector-right">
            <Icon name="selector" size="small" />
          </span>
        </button>
      }
    >
      <div class="am-dropdown-list">
        <For each={props.options}>
          {(opt, index) => (
            <>
              <Show when={heading(index())}>{(text) => <div class="diff-inline-group">{text()}</div>}</Show>
              <button
                class="am-branch-item"
                classList={{ "am-branch-item-active": opt.value === props.value }}
                type="button"
                onClick={() => choose(opt.value)}
              >
                <span class="am-branch-item-left">
                  <span class="am-branch-item-name">{opt.label}</span>
                </span>
                <Show when={opt.hint}>
                  <span class="am-branch-hint">{opt.hint}</span>
                </Show>
              </button>
            </>
          )}
        </For>
      </div>
    </DeferredPopover>
  )
}

/** Compact unified/split picker. Replaces the wide radio group in tight rows. */
export const DiffStyleSelect: Component<{
  value: "unified" | "split"
  onSelect: (value: "unified" | "split") => void
  unifiedLabel: string
  splitLabel: string
  title: string
}> = (props) => (
  <InlineSelect
    options={[
      { value: "unified", label: props.unifiedLabel },
      { value: "split", label: props.splitLabel },
    ]}
    value={props.value}
    onSelect={props.onSelect}
    title={props.title}
    class="diff-style-select"
    compact
  />
)
