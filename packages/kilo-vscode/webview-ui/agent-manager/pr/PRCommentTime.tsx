/** @jsxImportSource solid-js */
import { Show } from "solid-js"
import { formatRelativeDate } from "../../src/utils/date"

export function PRCommentTime(props: { time?: number }) {
  return (
    <Show when={props.time}>
      {(time) => <span class="am-pr-comment-time">{formatRelativeDate(new Date(time()).toISOString())}</span>}
    </Show>
  )
}
