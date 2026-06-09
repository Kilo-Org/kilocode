import { type Component, Show } from "solid-js"
import { useWorkStyle } from "../../context/work-style"
import { WorkStylePicker } from "../shared/WorkStylePicker"
import { KiloLogo, WelcomeEmptyState } from "./WelcomeEmptyState"

interface SidebarEmptyStateProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
}

export const SidebarEmptyState: Component<SidebarEmptyStateProps> = (props) => {
  const work = useWorkStyle()

  return (
    <Show
      when={work.shouldShowOnboarding()}
      fallback={<WelcomeEmptyState onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />}
    >
      <div class="message-list-empty">
        <KiloLogo />
        <WorkStylePicker variant="onboarding" />
      </div>
    </Show>
  )
}
