/** @jsxImportSource solid-js */
import { Show, type JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { PRCommentTime } from "./PRCommentTime"

/**
 * One compact conversation line for commits and lifecycle events. Comments and
 * reviews keep their full card; these rows exist so a push or a merge is
 * visible without looking like a discussion.
 */
export function PRTimelineRow(props: {
  icon: string
  label: JSX.Element | string
  time?: number
  onClick?: () => void
}) {
  const content = (
    <>
      <Icon name={props.icon} size="small" class="am-pr-timeline-icon" />
      <span class="am-pr-timeline-label">{props.label}</span>
      <PRCommentTime time={props.time} />
    </>
  )
  return (
    <Show
      when={props.onClick}
      fallback={
        <div class="am-pr-timeline-row am-pr-row" data-timeline-row>
          {content}
        </div>
      }
    >
      {(onClick) => (
        <button
          type="button"
          class="am-pr-timeline-row am-pr-row am-pr-timeline-toggle"
          data-timeline-row
          onClick={onClick()}
        >
          {content}
        </button>
      )}
    </Show>
  )
}
