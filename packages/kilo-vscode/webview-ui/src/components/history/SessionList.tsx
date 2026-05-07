/**
 * SessionList component
 * Displays all sessions grouped by date, with context menu for rename/delete.
 * Uses kilo-ui List component for keyboard navigation and accessibility.
 * Header/back button are owned by the parent HistoryView.
 */

import { Component, Show, createSignal, onMount, type JSX } from "solid-js"
import { List } from "@kilocode/kilo-ui/list"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { InlineInput } from "@kilocode/kilo-ui/inline-input"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import type { SessionInfo } from "../../types/messages"

const DATE_GROUP_KEYS = ["time.today", "time.yesterday", "time.thisWeek", "time.thisMonth", "time.older"] as const

function dateGroupKey(iso: string): (typeof DATE_GROUP_KEYS)[number] {
  const now = new Date()
  const then = new Date(iso)

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  const monthAgo = new Date(today.getTime() - 30 * 86400000)

  if (then >= today) return DATE_GROUP_KEYS[0]
  if (then >= yesterday) return DATE_GROUP_KEYS[1]
  if (then >= weekAgo) return DATE_GROUP_KEYS[2]
  if (then >= monthAgo) return DATE_GROUP_KEYS[3]
  return DATE_GROUP_KEYS[4]
}

interface SessionListProps {
  onSelectSession: (id: string) => void
}

const SessionList: Component<SessionListProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const dialog = useDialog()

  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameValue, setRenameValue] = createSignal("")

  onMount(() => {
    console.log("[Kilo New] SessionList mounted, loading sessions")
    session.loadSessions()
  })

  const currentSession = (): SessionInfo | undefined => {
    const id = session.currentSessionID()
    return session.sessions().find((s) => s.id === id)
  }

  function startRename(s: SessionInfo) {
    setRenamingId(s.id)
    setRenameValue(s.title || "")
  }

  function saveRename() {
    const id = renamingId()
    const title = renameValue().trim()
    if (!id || !title) {
      cancelRename()
      return
    }
    const existing = session.sessions().find((s) => s.id === id)
    if (!existing || title !== (existing.title || "")) {
      session.renameSession(id, title)
    }
    setRenamingId(null)
    setRenameValue("")
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameValue("")
  }

  function confirmDelete(s: SessionInfo) {
    dialog.show(() => (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("session.delete.confirm", { name: s.title || language.t("session.untitled") })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                session.deleteSession(s.id)
                dialog.close()
              }}
            >
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  function wrapItem(item: SessionInfo, node: JSX.Element): JSX.Element {
    return (
      <ContextMenu>
        <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
          {node}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => startRename(item)}>
              <ContextMenu.ItemLabel>{language.t("common.rename")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => confirmDelete(item)}>
              <ContextMenu.ItemLabel>{language.t("common.delete")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    )
  }

  return (
    <div class="session-list">
      <List<SessionInfo>
        items={session.sessions()}
        key={(s) => s.id}
        filterKeys={["title"]}
        current={currentSession()}
        onSelect={(s) => {
          if (s && renamingId() !== s.id) {
            props.onSelectSession(s.id)
          }
        }}
        search={{ placeholder: language.t("session.search.placeholder"), autofocus: false }}
        emptyMessage={language.t("session.empty")}
        groupBy={(s) => language.t(dateGroupKey(s.updatedAt))}
        sortGroupsBy={(a, b) => {
          const rank = Object.fromEntries(DATE_GROUP_KEYS.map((k, i) => [language.t(k), i]))
          return (rank[a.category] ?? 99) - (rank[b.category] ?? 99)
        }}
        itemWrapper={wrapItem}
      >
        {(s) => (
          <Show
            when={renamingId() === s.id}
            fallback={
              <>
                <span data-slot="list-item-title">{s.title || language.t("session.untitled")}</span>
                <span data-slot="list-item-description">{formatRelativeDate(s.updatedAt)}</span>
                <span
                  data-slot="session-delete-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    confirmDelete(s)
                  }}
                >
                  <IconButton
                    icon="trash"
                    size="small"
                    variant="ghost"
                    aria-label={language.t("session.delete.title")}
                  />
                </span>
              </>
            }
          >
            <InlineInput
              ref={(el) => requestAnimationFrame(() => el?.focus())}
              value={renameValue()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter") {
                  e.preventDefault()
                  saveRename()
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  cancelRename()
                }
              }}
              onBlur={() => saveRename()}
              style={{ width: "100%" }}
            />
          </Show>
        )}
      </List>
    </div>
  )
}

export default SessionList
