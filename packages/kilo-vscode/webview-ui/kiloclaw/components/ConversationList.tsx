// KiloClaw conversation sidebar — mirrors the web UI in
// cloud/apps/web/src/app/(app)/claw/kilo-chat/components/ConversationList.tsx

import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useClaw } from "../context/claw"
import { useKiloClawLanguage } from "../context/language"
import type { ConversationListItem } from "../lib/types"

type Group = { label: string; items: ConversationListItem[] }

function groupConversations(convs: ConversationListItem[], labels: Record<string, string>): Group[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000
  const weekStart = todayStart - 6 * 86_400_000

  const buckets: Record<string, ConversationListItem[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  }

  for (const c of convs) {
    const ts = c.lastActivityAt ?? c.joinedAt
    if (ts >= todayStart) buckets.today.push(c)
    else if (ts >= yesterdayStart) buckets.yesterday.push(c)
    else if (ts >= weekStart) buckets.week.push(c)
    else buckets.older.push(c)
  }

  const order: Array<[keyof typeof buckets, string]> = [
    ["today", labels.today],
    ["yesterday", labels.yesterday],
    ["week", labels.week],
    ["older", labels.older],
  ]
  return order.filter(([key]) => buckets[key].length > 0).map(([key, label]) => ({ label, items: buckets[key] }))
}

export function ConversationList() {
  const claw = useClaw()
  const { t } = useKiloClawLanguage()

  const groups = createMemo(() =>
    groupConversations(claw.conversations(), {
      today: t("kiloClaw.conversations.groupToday"),
      yesterday: t("kiloClaw.conversations.groupYesterday"),
      week: t("kiloClaw.conversations.groupThisWeek"),
      older: t("kiloClaw.conversations.groupOlder"),
    }),
  )

  let scrollEl!: HTMLDivElement

  const onScroll = () => {
    if (!scrollEl) return
    if (!claw.hasMoreConversations()) return
    if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80) {
      claw.loadMoreConversations()
    }
  }

  onMount(() => scrollEl?.addEventListener("scroll", onScroll))
  onCleanup(() => scrollEl?.removeEventListener("scroll", onScroll))

  return (
    <div class="kiloclaw-convlist">
      <div class="kiloclaw-convlist-header">
        <span class="kiloclaw-convlist-title">{t("kiloClaw.conversations.title")}</span>
        <button
          type="button"
          class="kiloclaw-iconbtn"
          onClick={() => claw.createConversation()}
          aria-label={t("kiloClaw.conversations.new")}
          title={t("kiloClaw.conversations.new")}
        >
          +
        </button>
      </div>
      <div class="kiloclaw-convlist-scroll" ref={scrollEl}>
        <Show
          when={claw.conversations().length > 0}
          fallback={<div class="kiloclaw-convlist-empty">{t("kiloClaw.conversations.empty")}</div>}
        >
          <For each={groups()}>
            {(group) => (
              <div class="kiloclaw-convlist-group">
                <div class="kiloclaw-convlist-grouplabel">{group.label}</div>
                <For each={group.items}>{(conv) => <ConversationItem conversation={conv} />}</For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

function ConversationItem(props: { conversation: ConversationListItem }) {
  const claw = useClaw()
  const { t } = useKiloClawLanguage()
  const [isRenaming, setIsRenaming] = createSignal(false)
  const [renameText, setRenameText] = createSignal("")
  let inputEl: HTMLInputElement | undefined

  const isActive = createMemo(() => claw.activeConversationId() === props.conversation.conversationId)
  const isUnread = createMemo(() => {
    const { lastActivityAt, lastReadAt } = props.conversation
    if (!lastActivityAt) return false
    return lastReadAt === null || lastReadAt < lastActivityAt
  })

  const startRename = (e: MouseEvent) => {
    e.stopPropagation()
    setRenameText(props.conversation.title ?? "")
    setIsRenaming(true)
    queueMicrotask(() => inputEl?.focus())
  }

  const commitRename = () => {
    const title = renameText().trim()
    if (title && title !== (props.conversation.title ?? "")) {
      claw.renameConversation(props.conversation.conversationId, title)
    }
    setIsRenaming(false)
  }

  const cancelRename = () => {
    setRenameText("")
    setIsRenaming(false)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commitRename()
    } else if (e.key === "Escape") {
      e.preventDefault()
      cancelRename()
    }
  }

  return (
    <div
      class={`kiloclaw-convitem ${isActive() ? "kiloclaw-convitem-active" : ""}`}
      onClick={() => {
        if (isRenaming()) return
        claw.selectConversation(props.conversation.conversationId)
      }}
      role="button"
      tabindex={0}
    >
      <Show
        when={!isRenaming()}
        fallback={
          <input
            ref={inputEl}
            class="kiloclaw-convitem-renameinput"
            value={renameText()}
            onInput={(e) => setRenameText(e.currentTarget.value)}
            onKeyDown={onKey}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            maxLength={200}
          />
        }
      >
        <span class="kiloclaw-convitem-title">
          <Show when={isUnread()}>
            <span class="kiloclaw-convitem-unread" aria-hidden="true" />
          </Show>
          {props.conversation.title ?? t("kiloClaw.conversations.untitled")}
        </span>
      </Show>
      <div class="kiloclaw-convitem-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="kiloclaw-iconbtn-sm"
          onClick={startRename}
          title={t("kiloClaw.conversations.rename")}
          aria-label={t("kiloClaw.conversations.rename")}
        >
          ✎
        </button>
        <button
          type="button"
          class="kiloclaw-iconbtn-sm kiloclaw-iconbtn-danger"
          onClick={() => claw.leaveConversation(props.conversation.conversationId)}
          title={t("kiloClaw.conversations.leave")}
          aria-label={t("kiloClaw.conversations.leave")}
        >
          ×
        </button>
      </div>
    </div>
  )
}
