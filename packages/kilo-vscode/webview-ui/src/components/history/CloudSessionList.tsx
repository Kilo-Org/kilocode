/**
 * CloudSessionList component
 * Displays cloud sessions from the Kilo cloud API, grouped by date.
 * Supports filtering by repository (git URL) and search by title.
 */

import { Component, createSignal, createEffect, onMount, onCleanup, Show } from "solid-js"
import { List } from "@kilocode/kilo-ui/list"
import { Button } from "@kilocode/kilo-ui/button"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import type { CloudSessionInfo, ExtensionMessage } from "../../types/messages"

const DATE_GROUP_KEYS = ["time.today", "time.yesterday", "time.thisWeek", "time.thisMonth", "time.older"] as const

function dateGroupKey(iso: string): (typeof DATE_GROUP_KEYS)[number] {
  const now = new Date()
  const then = new Date(iso)

  const DAY_MS = 24 * 60 * 60 * 1000

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - DAY_MS)
  const weekAgo = new Date(today.getTime() - 7 * DAY_MS)
  const monthAgo = new Date(today.getTime() - 30 * DAY_MS)

  if (then >= today) return DATE_GROUP_KEYS[0]
  if (then >= yesterday) return DATE_GROUP_KEYS[1]
  if (then >= weekAgo) return DATE_GROUP_KEYS[2]
  if (then >= monthAgo) return DATE_GROUP_KEYS[3]
  return DATE_GROUP_KEYS[4]
}

interface DisplaySession {
  id: string
  title: string
  updatedAt: string
  createdAt: string
}

function toDisplay(s: CloudSessionInfo): DisplaySession {
  return {
    id: s.session_id,
    title: s.title ?? "Untitled",
    updatedAt: s.updated_at,
    createdAt: s.created_at,
  }
}

interface CloudSessionListProps {
  onSelectSession?: (id: string) => void
}

const CloudSessionList: Component<CloudSessionListProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [sessions, setSessions] = createSignal<DisplaySession[]>([])
  const [loading, setLoading] = createSignal(false)
  const [nextCursor, setNextCursor] = createSignal<string | null>(null)
  const [gitUrl, setGitUrl] = createSignal<string | null>(null)
  const [repoOnly, setRepoOnly] = createSignal(true)
  const [initialized, setInitialized] = createSignal(false)

  let loadGen = 0
  let activeGen = 0

  const unsub = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "cloudSessionsLoaded") {
      if (activeGen !== loadGen) return
      const incoming = message.sessions.map(toDisplay)
      const cursor = nextCursor()
      if (cursor && incoming.length > 0) {
        setSessions((prev) => {
          const seen = new Set(prev.map((s) => s.id))
          return [...prev, ...incoming.filter((s) => !seen.has(s.id))]
        })
      } else if (!cursor) {
        setSessions(incoming)
      }
      setNextCursor(message.nextCursor)
      setLoading(false)
    }
    if (message.type === "gitRemoteUrlLoaded") {
      setGitUrl(message.gitUrl)
      setInitialized(true)
    }
  })

  onCleanup(unsub)

  onMount(() => {
    vscode.postMessage({ type: "requestGitRemoteUrl" })
  })

  createEffect(() => {
    if (!initialized()) return
    const url = repoOnly() ? gitUrl() : undefined
    loadGen++
    activeGen = loadGen
    setLoading(true)
    setSessions([])
    setNextCursor(null)
    vscode.postMessage({
      type: "requestCloudSessions",
      limit: 50,
      gitUrl: url ?? undefined,
    })
  })

  function loadMore() {
    const cursor = nextCursor()
    if (!cursor || loading()) return
    const url = repoOnly() ? gitUrl() : undefined
    activeGen = loadGen
    setLoading(true)
    vscode.postMessage({
      type: "requestCloudSessions",
      cursor,
      limit: 50,
      gitUrl: url ?? undefined,
    })
  }

  return (
    <div class="session-list cloud-session-list">
      <div class="cloud-session-filters">
        <Checkbox checked={repoOnly()} onChange={setRepoOnly}>
          {language.t("session.cloud.repoOnly") ?? "Only this repository"}
        </Checkbox>
      </div>
      <List<DisplaySession>
        items={sessions()}
        key={(s) => s.id}
        filterKeys={["title"]}
        onSelect={(s) => {
          if (s) props.onSelectSession?.(s.id)
        }}
        search={{ placeholder: language.t("session.search.placeholder"), autofocus: false }}
        emptyMessage={
          loading() ? (language.t("common.loading") ?? "Loading...") : (language.t("session.empty") ?? "No sessions")
        }
        groupBy={(s) => language.t(dateGroupKey(s.updatedAt))}
        sortGroupsBy={(a, b) => {
          const rank = Object.fromEntries(DATE_GROUP_KEYS.map((k, i) => [language.t(k), i]))
          return (rank[a.category] ?? 99) - (rank[b.category] ?? 99)
        }}
      >
        {(s) => (
          <>
            <span data-slot="list-item-title">{s.title}</span>
            <span data-slot="list-item-description">{formatRelativeDate(s.updatedAt)}</span>
          </>
        )}
      </List>
      <Show when={nextCursor() && !loading()}>
        <div class="cloud-session-load-more">
          <Button variant="ghost" size="small" onClick={loadMore}>
            {language.t("common.loadMore") ?? "Load more"}
          </Button>
        </div>
      </Show>
    </div>
  )
}

export default CloudSessionList
