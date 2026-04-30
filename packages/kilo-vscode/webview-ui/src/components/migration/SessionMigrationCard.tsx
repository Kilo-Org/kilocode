import type { Component, JSX } from "solid-js"

interface SessionMigrationCardProps {
  children: JSX.Element
}

const SessionMigrationCard: Component<SessionMigrationCardProps> = (props) => {
  return <div class="migration-session-card">{props.children}</div>
}

export default SessionMigrationCard
