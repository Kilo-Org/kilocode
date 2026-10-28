import type { SessionInfo } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { List } from "@kilocode/kilo-ui/list"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { SessionRenameEditor } from "../components/shared/SessionRenameEditor"
import { useLanguage } from "../context/language"
import { formatRelativeDate } from "../utils/date"
import { useV2 } from "./client"

const groups = ["time.today", "time.yesterday", "time.thisWeek", "time.thisMonth", "time.older"] as const

function group(time: number) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (time >= today) return groups[0]
  if (time >= today - 86400000) return groups[1]
  if (time >= today - 7 * 86400000) return groups[2]
  if (time >= today - 30 * 86400000) return groups[3]
  return groups[4]
}

export function SessionList(props: { onOpen: (id: string) => void }) {
  const v2 = useV2()
  const language = useLanguage()
  const dialog = useDialog()
  const [renaming, setRenaming] = createSignal<string>()
  const [pending, setPending] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)
  const [notice, setNotice] = createSignal("")
  const [removed, setRemoved] = createSignal<ReadonlySet<string>>(new Set())
  const items = createMemo(() =>
    v2.data.session
      .list()
      .filter((item) => !item.parentID && item.location.directory === v2.directory && !removed().has(item.id))
      .toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const name = (item: SessionInfo) => item.title || language.t("session.untitled")
  const label = (action: string, item: SessionInfo) => `${action}: ${name(item)}`
  const rename = (item: SessionInfo) => {
    if (saving()) return
    setRenaming(item.id)
  }
  const save = (title: string) => {
    const id = renaming()
    if (!id || saving()) return
    const item = v2.data.session.get(id)
    if (title === (item?.title ?? "")) {
      setRenaming(undefined)
      return
    }
    setSaving(true)
    void v2.api.session
      .update({ sessionID: id, title })
      .then(() => {
        if (item) v2.data.session.remember({ ...item, title })
        setRenaming(undefined)
        v2.data.session.invalidate(id)
        return v2.data.session.sync(id)
      })
      .catch(v2.report)
      .finally(() => setSaving(false))
  }
  const remove = (item: SessionInfo, restore?: HTMLElement) => {
    dialog.show(
      () => {
        const [deleting, setDeleting] = createSignal(false)
        return (
          <Dialog title={language.t("session.delete.title")} fit>
            <div class="dialog-confirm-body">
              <span>{language.t("session.delete.confirm", { name: name(item) })}</span>
              <div class="dialog-confirm-actions">
                <Button variant="ghost" size="large" disabled={deleting()} onClick={() => dialog.close()}>
                  {language.t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  size="large"
                  disabled={deleting()}
                  onClick={() => {
                    if (deleting()) return
                    setDeleting(true)
                    void v2.api.session
                      .remove({ sessionID: item.id })
                      .then(() => {
                        setRemoved((removed) => new Set([...removed, item.id]))
                        dialog.close()
                      })
                      .catch(v2.report)
                      .finally(() => setDeleting(false))
                  }}
                >
                  {language.t("session.delete.button")}
                </Button>
              </div>
            </div>
          </Dialog>
        )
      },
      () => queueMicrotask(() => restore?.isConnected && restore.focus()),
    )
  }
  const wrap = (item: SessionInfo, node: JSX.Element) => (
    <ContextMenu>
      <ContextMenu.Trigger as="div" class="session-row" data-session-id={item.id}>
        <Show
          when={renaming() === item.id}
          fallback={
            <>
              {node}
              <IconButton
                data-slot="session-row-action"
                icon="edit"
                size="small"
                variant="ghost"
                aria-label={label(language.t("common.rename"), item)}
                onClick={() => rename(item)}
                disabled={saving()}
              />
              <IconButton
                data-slot="session-row-action"
                icon="trash"
                size="small"
                variant="ghost"
                aria-label={label(language.t("session.delete.title"), item)}
                onClick={(event) => remove(item, event.currentTarget)}
                disabled={saving()}
              />
            </>
          }
        >
          <div data-slot="session-row-editor" data-component="rename-input" inert={saving() || undefined}>
            <SessionRenameEditor
              title={item.title || ""}
              fill
              stop
              onSave={save}
              onCancel={() => setRenaming(undefined)}
            />
          </div>
        </Show>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          class="session-list-menu"
          onCloseAutoFocus={(event) => {
            if (pending() !== item.id) return
            event.preventDefault()
            setPending(undefined)
            rename(item)
          }}
        >
          <ContextMenu.Item onSelect={() => setPending(item.id)}>
            <ContextMenu.ItemLabel>{language.t("common.rename")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => remove(item)}>
            <ContextMenu.ItemLabel>{language.t("common.delete")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )

  return (
    <div class="session-list">
      <List<SessionInfo>
        items={items()}
        key={(item) => item.id}
        filterKeys={["title"]}
        onMove={(item) => setNotice(item ? name(item) : "")}
        onSelect={(item) => {
          if (item && renaming() !== item.id) props.onOpen(item.id)
        }}
        search={{ placeholder: language.t("session.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("session.empty")}
        groupBy={(item) => language.t(group(item.time.updated))}
        sortGroupsBy={(a, b) => {
          const rank = Object.fromEntries(groups.map((key, index) => [language.t(key), index]))
          return (rank[a.category] ?? 99) - (rank[b.category] ?? 99)
        }}
        itemWrapper={wrap}
      >
        {(item) => (
          <>
            <span data-slot="list-item-title" dir="auto">
              {name(item)}
            </span>
            <Show when={v2.data.session.status(item.id) === "running"}>
              <span data-slot="session-running" role="status" aria-label={language.t("session.status.working")}>
                <Spinner />
              </span>
            </Show>
            <span data-slot="list-item-description">
              {formatRelativeDate(new Date(item.time.updated).toISOString())}
            </span>
          </>
        )}
      </List>
      <div data-slot="session-list-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {notice()}
      </div>
    </div>
  )
}
