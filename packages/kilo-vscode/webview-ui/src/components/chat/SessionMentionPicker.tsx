/** @jsxImportSource solid-js */

import { onMount } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { List } from "@kilocode/kilo-ui/list"
import type { SessionSearchItem } from "../../types/messages"
import { formatRelativeDate } from "../../utils/date"

interface Props {
  sessions: SessionSearchItem[]
  onSelect: (session: SessionSearchItem) => void
  onClose: () => void
}

/**
 * Inline past-chat picker for @-mentions, mirroring the Agent Manager sidebar
 * search: a search field over a directory-scoped session list, fuzzy-filtered
 * client-side by the kilo-ui List component (same mechanism).
 */
export function SessionMentionPicker(props: Props) {
  let root: HTMLDivElement | undefined

  onMount(() => {
    // The List's own autofocus does not reliably win against the textarea
    // keeping focus in the webview; focus the search field explicitly, same
    // as the Agent Manager sidebar search does.
    queueMicrotask(() => root?.querySelector("input")?.focus({ preventScroll: true }))
  })

  return (
    <div
      ref={root}
      class="session-mention-picker"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          props.onClose()
        }
      }}
    >
      <List<SessionSearchItem>
        items={props.sessions}
        key={(item) => item.id}
        filterKeys={["title"]}
        search={{ placeholder: "Search sessions", autofocus: true }}
        onSelect={(item) => {
          if (item) props.onSelect(item)
        }}
      >
        {(item) => (
          <span class="session-mention-item">
            <Icon name="history" class="file-mention-icon" />
            <span class="session-mention-title">{item.title}</span>
            <span class="session-mention-time">{formatRelativeDate(new Date(item.updated).toISOString())}</span>
          </span>
        )}
      </List>
    </div>
  )
}
