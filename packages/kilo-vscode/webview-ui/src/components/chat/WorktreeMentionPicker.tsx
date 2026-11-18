import { createMemo, onMount } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { List } from "@kilocode/kilo-ui/list"
import { useLanguage } from "../../context/language"
import type { WorktreeReference } from "../../hooks/file-mention-utils"

interface Props {
  worktrees: WorktreeReference[]
  onSelect: (worktree: WorktreeReference) => void
  onClose: () => void
}

export function WorktreeMentionPicker(props: Props) {
  const language = useLanguage()
  const items = createMemo(() =>
    props.worktrees.map((worktree) => ({
      ...worktree,
      search: [worktree.name, worktree.branch, ...worktree.sessions.map((session) => session.title)].join(" "),
    })),
  )
  let root: HTMLDivElement | undefined
  onMount(() => queueMicrotask(() => root?.querySelector("input")?.focus({ preventScroll: true })))

  return (
    <div
      ref={root}
      class="session-mention-picker worktree-mention-picker"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        props.onClose()
      }}
    >
      <List
        items={items()}
        key={(item) => item.path}
        filterKeys={["name", "branch", "search"]}
        search={{ placeholder: language.t("prompt.worktrees.search"), autofocus: true }}
        onSelect={(item) => {
          if (item) props.onSelect(item)
        }}
        onKeyEvent={(event, item) => {
          if (event.key !== "Tab" || event.shiftKey || event.isComposing || !item) return
          event.preventDefault()
          props.onSelect(item)
        }}
      >
        {(item) => (
          <span class="session-mention-item" title={item.path}>
            <Icon name="branch" class="file-mention-icon" />
            <span class="session-mention-title">{item.name}</span>
            <span class="session-mention-worktree">{item.branch}</span>
          </span>
        )}
      </List>
    </div>
  )
}
