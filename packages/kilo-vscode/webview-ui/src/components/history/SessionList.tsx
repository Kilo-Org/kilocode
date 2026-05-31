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
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import type { SessionInfo } from "../../types/messages"
import { SessionRenameEditor } from "../shared/SessionRenameEditor"

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
  const [pendingRenameId, setPendingRenameId] = createSignal<string | null>(null)
  const [notice, setNotice] = createSignal("")
  let seq = 0

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
  }

  function saveRename(title: string) {
    const id = renamingId()
    if (!id) return
    const existing = session.sessions().find((s) => s.id === id)
    if (!existing || title !== (existing.title || "")) session.renameSession(id, title)
    setRenamingId(null)
  }

  function cancelRename() {
    setRenamingId(null)
  }

  function name(s: SessionInfo) {
    return s.title || language.t("session.untitled")
  }

  function label(action: string, s: SessionInfo) {
    return `${action}: ${name(s)}`
  }

  function announce(s: SessionInfo | undefined) {
    const id = ++seq
    setNotice("")
    if (!s) return
    queueMicrotask(() => {
      if (id !== seq) return
      const current = session.currentSessionID() === s.id ? `. ${language.t("session.current")}` : ""
      setNotice(`${name(s)}${current}`)
    })
  }

  function confirmDelete(s: SessionInfo, restore?: HTMLElement) {
    dialog.show(
      () => (
        <Dialog title={language.t("session.delete.title")} fit>
          <div class="dialog-confirm-body">
            <span>{language.t("session.delete.confirm", { name: name(s) })}</span>
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
      ),
      () => {
        queueMicrotask(() => {
          if (restore?.isConnected) restore.focus()
        })
      },
    )
  }

  function wrapItem(item: SessionInfo, node: JSX.Element): JSX.Element {
    return (
      <ContextMenu>
        <ContextMenu.Trigger as="div" class="session-row">
          <Show
            when={renamingId() === item.id}
            fallback={
              <>
                {node}
                <IconButton
                  data-slot="session-row-action"
                  icon="edit"
                  size="small"
                  variant="ghost"
                  aria-label={label(language.t("common.rename"), item)}
                  onClick={() => startRename(item)}
                />
                <IconButton
                  data-slot="session-row-action"
                  icon="trash"
                  size="small"
                  variant="ghost"
                  aria-label={label(language.t("session.delete.title"), item)}
                  onClick={(event) => confirmDelete(item, event.currentTarget)}
                />
              </>
            }
          >
            <div data-slot="session-row-editor">
              <SessionRenameEditor title={item.title || ""} fill onSave={saveRename} onCancel={cancelRename} />
            </div>
          </Show>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            class="session-list-menu"
            onCloseAutoFocus={(event) => {
              if (pendingRenameId() !== item.id) return
              event.preventDefault()
              setPendingRenameId(null)
              startRename(item)
            }}
          >
            <ContextMenu.Item onSelect={() => setPendingRenameId(item.id)}>
              <ContextMenu.ItemLabel>{language.t("common.rename")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => session.exportSessionTranscript(item.id)}>
              <ContextMenu.ItemLabel>{language.t("command.session.export")}</ContextMenu.ItemLabel>
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
        onMove={announce}
        onSelect={(s) => {
          if (s && renamingId() !== s.id) {
            props.onSelectSession(s.id)
          }
        }}
        search={{ placeholder: language.t("session.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("session.empty")}
        groupBy={(s) => language.t(dateGroupKey(s.updatedAt))}
        sortGroupsBy={(a, b) => {
          const rank = Object.fromEntries(DATE_GROUP_KEYS.map((k, i) => [language.t(k), i]))
          return (rank[a.category] ?? 99) - (rank[b.category] ?? 99)
        }}
        itemWrapper={wrapItem}
      >
        {(s) => (
          <>
            <span data-slot="list-item-title">{name(s)}</span>
            <span data-slot="list-item-description">{formatRelativeDate(s.updatedAt)}</span>
            <Show when={session.currentSessionID() === s.id}>
              <span class="sr-only">{language.t("session.current")}</span>
            </Show>
          </>
        )}
      </List>
      <div data-slot="session-list-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {notice()}
      </div>
    </div>
  )
}

export default SessionList
