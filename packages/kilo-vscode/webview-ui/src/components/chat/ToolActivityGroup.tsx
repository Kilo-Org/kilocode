/**
 * A compact activity row has two levels only: one stable summary and the real
 * part cards. Live state changes the summary, never whether details are mounted.
 */

import { For, Index, Show, createMemo, onMount, type Component, type JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { getToolInfo } from "@kilocode/kilo-ui/message-part"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { AnimatedCountList } from "@kilocode/kilo-ui/tool-count-summary"
import type { TranscriptActivityItem } from "../../context/transcript-rows"
import { useLanguage } from "../../context/language"
import { StatusText } from "../shared/StatusText"
import { CHIPS, ICON, LIVE, category, settled, type ActivityPart } from "./tool-activity"

function icon(part: ActivityPart) {
  const kind = category(part)!
  if (kind !== "other") return ICON[kind]
  return getToolInfo(part.tool ?? "", part.state?.input ?? {}).icon
}

const Chip: Component<{ part: ActivityPart; index: number; live: boolean }> = (props) => (
  <span data-slot="tool-activity-chip" data-live={props.live ? "" : undefined} style={{ "--i": props.index }}>
    <Show when={props.live} fallback={<Icon name={icon(props.part)} size="small" />}>
      <Spinner />
    </Show>
  </span>
)

export const ToolActivityGroup: Component<{
  groupKey: string
  items: TranscriptActivityItem[]
  live: boolean
  open: boolean
  cascade: boolean
  forced?: string
  onOpenChange: (open: boolean) => void
  onCascade: () => void
  render: (item: () => TranscriptActivityItem) => JSX.Element
}> = (props) => {
  const language = useLanguage()
  const keys = createMemo(() => props.items.map((item) => item.key))
  const lookup = createMemo(() => new Map(props.items.map((item) => [item.key, item])))

  // Tool updates replace SDK objects frequently. Only the part status determines
  // activity; the last item owns the spinner through the settled gap before the
  // next tool arrives.
  const active = createMemo(() => {
    if (!props.live) return undefined
    return (props.items.find((item) => !settled(item.part as ActivityPart)) ?? props.items.at(-1))?.key
  })
  const shown = createMemo(() => {
    if (props.items.length <= CHIPS) return props.items
    const key = active()
    const item = key ? lookup().get(key) : undefined
    const first = props.items.slice(0, CHIPS)
    if (!item || first.some((entry) => entry.key === key)) return first
    return [...first.slice(0, CHIPS - 1), item]
  })
  const extra = createMemo(() => Math.max(0, props.items.length - CHIPS))
  const status = createMemo(() => {
    const item = active() ? lookup().get(active()!) : undefined
    if (!item) return language.t("session.status.working")
    const part = item.part as ActivityPart
    const kind = category(part)!
    if (kind === "other") return getToolInfo(part.tool ?? "", part.state?.input ?? {}).title
    return language.t(LIVE[kind])
  })
  onMount(props.onCascade)

  const visible = () => props.open || !!props.forced

  const count = () => (
    <AnimatedCountList
      items={[
        {
          key: "tools",
          count: props.items.length,
          one: language.t("chat.activity.count_one"),
          other: language.t("chat.activity.count_other"),
        },
      ]}
    />
  )

  return (
    <div
      data-component="tool-activity"
      data-group-key={props.groupKey}
      data-open={visible() ? "" : undefined}
      data-cascade={props.cascade ? "" : undefined}
      data-live={props.live ? "" : undefined}
    >
      <button
        type="button"
        data-slot="tool-activity-header"
        aria-expanded={visible()}
        aria-label={language.t(visible() ? "dialog.model.collapse" : "dialog.model.expand")}
        onClick={() => props.onOpenChange(!visible())}
      >
        <span data-slot="tool-activity-chips">
          <span data-slot="tool-activity-chips-inner">
            <Index each={shown()}>
              {(item, index) => (
                <Chip part={item().part as ActivityPart} index={index} live={active() === item().key} />
              )}
            </Index>
            <Show when={extra() > 0}>
              <span data-slot="tool-activity-chip" data-extra="" style={{ "--i": CHIPS }}>
                {language.t("chat.activity.overflow", { count: extra() })}
              </span>
            </Show>
          </span>
        </span>
        <span data-slot="tool-activity-label">
          <span data-slot="tool-activity-label-line" data-status={props.live ? "" : undefined}>
            <Show when={props.live} fallback={count()}>
              <StatusText text={status()} />
            </Show>
          </span>
        </span>
        <Icon name="chevron-down" size="small" data-slot="tool-activity-arrow" />
      </button>
      <Show when={visible()}>
        <div data-slot="tool-activity-details">
          <For each={keys()}>{(key) => props.render(() => lookup().get(key)!)}</For>
        </div>
      </Show>
    </div>
  )
}
