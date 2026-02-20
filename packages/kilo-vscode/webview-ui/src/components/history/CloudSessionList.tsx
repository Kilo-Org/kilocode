/**
 * CloudSessionList component
 * Displays sessions synced to Kilo cloud, grouped by date.
 * Clicking a session imports it to local storage and opens it.
 */

import { Component, For, Show, createSignal, onMount } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
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

function groupByDate(sessions: CloudSession[]): Array<{ key: string; items: CloudSession[] }> {
  const map = new Map<string, CloudSession[]>()
  for (const key of DATE_GROUP_KEYS) map.set(key, [])
  for (const s of sessions) {
    map.get(dateGroupKey(s.updated_at))!.push(s)
  }
  return DATE_GROUP_KEYS.filter((k) => map.get(k)!.length > 0).map((k) => ({ key: k, items: map.get(k)! }))
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

  const groups = () => groupByDate(session.cloudSessions())

  const handleSelect = (s: CloudSession) => {
    if (session.importingCloudSessionId()) return
    session.importCloudSession(s.session_id)
  }

  const handleLoadMore = () => {
    const cursor = session.cloudSessionsNextCursor()
    if (!cursor) return
    session.loadCloudSessions(cursor)
  }

  // Clear loading once sessions arrive
  const cloudSessions = () => {
    const list = session.cloudSessions()
    if (loading() && (list.length > 0 || session.cloudSessionsNextCursor() === null)) {
      setLoading(false)
    }
    return list
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
      <Show when={isLoggedIn() && !loading() && cloudSessions().length === 0}>
        <div class="session-list-empty">
          <span>{language.t("session.cloud.empty")}</span>
        </div>
      </Show>
      <Show when={isLoggedIn() && !loading() && cloudSessions().length > 0}>
        <For each={groups()}>
          {(group) => (
            <div class="session-group">
              <div class="session-group-label">{language.t(group.key)}</div>
              <For each={group.items}>
                {(s) => {
                  const importing = () => session.importingCloudSessionId() === s.session_id
                  return (
                    <button
                      class="session-item"
                      onClick={() => handleSelect(s)}
                      disabled={!!session.importingCloudSessionId()}
                    >
                      <Show when={importing()}>
                        <Spinner />
                      </Show>
                      <span class="session-item-title">{s.title || language.t("session.untitled")}</span>
                      <span class="session-item-date">{formatRelativeDate(s.updated_at)}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          )}
        </For>
        <Show when={!!session.cloudSessionsNextCursor()}>
          <button class="session-load-more" onClick={handleLoadMore}>
            {language.t("session.cloud.loadMore")}
          </button>
        </Show>
      </Show>
    </div>
  )
}

export default CloudSessionList
