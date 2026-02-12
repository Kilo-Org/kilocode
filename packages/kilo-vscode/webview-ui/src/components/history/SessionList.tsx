/**
 * SessionList component
 * Displays all sessions sorted by most recent, allowing selection.
 * Uses kilo-ui List component for keyboard navigation and accessibility.
 */

import { Component, onMount } from "solid-js"
import { List } from "@kilocode/kilo-ui/list"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { SessionInfo } from "../../types/messages"

type TranslateFn = (key: string, params?: Record<string, string | number>) => string

function formatRelativeDate(iso: string, t: TranslateFn): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = now - then

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) {
    return t("time.justNow")
  }

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return t("time.minutesAgo", { count: minutes })
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t("time.hoursAgo", { count: hours })
  }

  const days = Math.floor(hours / 24)
  if (days < 30) {
    return t("time.daysAgo", { count: days })
  }

  const months = Math.floor(days / 30)
  return t("time.monthsAgo", { count: months })
}

interface SessionListProps {
  onSelectSession: (id: string) => void
}

const SessionList: Component<SessionListProps> = (props) => {
  const session = useSession()
  const language = useLanguage()

  onMount(() => {
    console.log("[Kilo New] SessionList mounted, loading sessions")
    session.loadSessions()
  })

  const currentSession = (): SessionInfo | undefined => {
    const id = session.currentSessionID()
    return session.sessions().find((s) => s.id === id)
  }

  return (
    <div class="session-list">
      <List<SessionInfo>
        items={session.sessions()}
        key={(s) => s.id}
        filterKeys={["title"]}
        current={currentSession()}
        onSelect={(s) => {
          if (s) {
            props.onSelectSession(s.id)
          }
        }}
        search={{ placeholder: language.t("session.search.placeholder"), autofocus: false }}
        emptyMessage={language.t("session.empty")}
      >
        {(s) => (
          <>
            <span data-slot="list-item-title">{s.title || language.t("session.untitled")}</span>
            <span data-slot="list-item-description">{formatRelativeDate(s.updatedAt, language.t)}</span>
          </>
        )}
      </List>
    </div>
  )
}

export default SessionList
