/**
 * CloudSessionList component
 * Displays sessions synced to Kilo cloud, grouped by date.
 * Clicking a session imports it to local storage and opens it.
 * Uses kilo-ui List component for consistent styling with SessionList.
 */

import { Component, Show, createSignal, createEffect, onMount } from "solid-js"
import { List } from "@kilocode/kilo-ui/list"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import type { CloudSession } from "../../types/messages"

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

interface CloudSessionListProps {
  onSelectSession: (id: string) => void
}

const CloudSessionList: Component<CloudSessionListProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const [loading, setLoading] = createSignal(false)

  onMount(() => {
    if (!server.isConnected()) return
    setLoading(true)
    session.loadCloudSessions()
  })

  // Clear loading once cloud sessions response arrives
  createEffect(() => {
    if (session.cloudSessionsLoaded()) {
      setLoading(false)
    }
  })

  // Track which cloud session ID we're importing so we can navigate on completion
  const [pendingImport, setPendingImport] = createSignal<string | null>(null)

  // Navigate to the imported session once it arrives
  createEffect(() => {
    const pending = pendingImport()
    if (!pending) return
    // importingCloudSessionId goes null when import finishes (success or failure)
    if (session.importingCloudSessionId()) return
    const id = session.currentSessionID()
    setPendingImport(null)
    if (id) props.onSelectSession(id)
  })

  const handleSelect = (s: CloudSession | undefined) => {
    if (!s || session.importingCloudSessionId()) return
    setPendingImport(s.session_id)
    session.importCloudSession(s.session_id)
  }

  const handleLoadMore = () => {
    const cursor = session.cloudSessionsNextCursor()
    if (!cursor) return
    session.loadCloudSessions(cursor)
  }

  const isLoggedIn = () => server.profileData() !== null

  return (
    <div class="session-list" data-component="cloud-session-list">
      <Show when={!isLoggedIn()}>
        <div class="session-list-empty">
          <span>{language.t("session.cloud.loginRequired")}</span>
        </div>
      </Show>
      <Show when={isLoggedIn() && loading()}>
        <div class="session-list-loading">
          <Spinner />
        </div>
      </Show>
      <Show when={isLoggedIn() && !loading()}>
        <List<CloudSession>
          items={session.cloudSessions()}
          key={(s) => s.session_id}
          filterKeys={["title"]}
          onSelect={handleSelect}
          search={{ placeholder: language.t("session.search.placeholder"), autofocus: false }}
          emptyMessage={language.t("session.cloud.empty")}
          groupBy={(s) => language.t(dateGroupKey(s.updated_at))}
          sortGroupsBy={(a, b) => {
            const rank = Object.fromEntries(DATE_GROUP_KEYS.map((k, i) => [language.t(k), i]))
            return (rank[a.category] ?? 99) - (rank[b.category] ?? 99)
          }}
        >
          {(s) => {
            const importing = () => session.importingCloudSessionId() === s.session_id
            return (
              <>
                <span data-slot="list-item-title">{s.title || language.t("session.untitled")}</span>
                <Show
                  when={importing()}
                  fallback={<span data-slot="list-item-description">{formatRelativeDate(s.updated_at)}</span>}
                >
                  <Spinner />
                </Show>
              </>
            )
          }}
        </List>
        <Show when={!!session.cloudSessionsNextCursor()}>
          <div style={{ padding: "8px 12px" }}>
            <Button variant="ghost" size="small" onClick={handleLoadMore}>
              {language.t("session.cloud.loadMore")}
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  )
}

export default CloudSessionList
