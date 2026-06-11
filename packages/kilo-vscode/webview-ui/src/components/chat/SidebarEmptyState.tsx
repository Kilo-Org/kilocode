import { type Component, Show } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useWorkStyle } from "../../context/work-style"
import { useLanguage } from "../../context/language"
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
        <div class="message-list-empty work-style-empty">
          <KiloLogo />
          <h1 class="work-style-welcome">{language.t("workStyle.onboarding.welcome")}</h1>
          <WorkStylePicker />
        </div>
      </Show>
    </Show>
  )
}
