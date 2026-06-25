import { type Component, Show } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useWorkStyle } from "../../context/work-style"
import { useLanguage } from "../../context/language"
import { AgentPicker } from "../shared/AgentPicker"
import { WorkStylePicker } from "../shared/WorkStylePicker"
import { KiloLogo, WelcomeEmptyState } from "./WelcomeEmptyState"

interface SidebarEmptyStateProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
}

export const SidebarEmptyState: Component<SidebarEmptyStateProps> = (props) => {
  const work = useWorkStyle()
  const language = useLanguage()

  return (
    <Show
      when={!work.loading()}
      fallback={
        <div class="message-list-loading" role="status">
          <Spinner />
          <span>{language.t("session.messages.initializing")}</span>
        </div>
      }
    >
      <Show
        when={work.shouldShowOnboarding()}
        fallback={<WelcomeEmptyState onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />}
      >
        <div class="message-list-empty onboarding-empty">
          <KiloLogo />
          <h1 class="onboarding-welcome">{language.t("workStyle.onboarding.welcome")}</h1>
          <Show when={work.page() === "style"} fallback={<AgentPicker />}>
            <WorkStylePicker />
          </Show>
        </div>
      </Show>
    </Show>
  )
}
