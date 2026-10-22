import { type Component } from "solid-js"
import { WelcomeEmptyState } from "./WelcomeEmptyState"

interface SidebarEmptyStateProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
}

export const SidebarEmptyState: Component<SidebarEmptyStateProps> = (props) => (
  <WelcomeEmptyState onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />
)
