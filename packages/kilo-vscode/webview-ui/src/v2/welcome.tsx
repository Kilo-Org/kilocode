// main's sidebar empty state (components/chat/WelcomeEmptyState.tsx) on v2 sessions.
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createSignal, For, Show, type JSX } from "solid-js"
import { AnimatedKiloLogo, reduced } from "../components/brand/AnimatedKiloLogo"
import { useLanguage } from "../context/language"
import { useWorkStyleOptional } from "../context/work-style"
import { WorkStylePicker } from "../components/shared/WorkStylePicker"
import { formatRelativeDate } from "../utils/date"
import { useV2 } from "./client"
import { FeedbackDialog } from "./feedback"

const RECENT = 3

/**
 * Square Kilo mark. Hover rotates the mark and crossfades to the yellow Lottie animation. The player mounts on
 * first hover, so the WASM renderer never delays the empty state.
 */
export const KiloLogo = () => {
  const icons = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const light =
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
  const file = light ? "kilo-light.svg" : "kilo-dark.svg"
  const [hover, setHover] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [mounted, setMounted] = createSignal(false)

  return (
    <div
      class="kilo-logo"
      classList={{ "kilo-logo-hover": hover(), "kilo-logo-ready": hover() && ready() }}
      onMouseEnter={() => {
        if (reduced()) return
        setMounted(true)
        setHover(true)
      }}
      onMouseLeave={() => setHover(false)}
    >
      <Show when={mounted()}>
        <div class="kilo-logo-layer kilo-logo-animated">
          <AnimatedKiloLogo playing={hover() && ready()} onReady={setReady} />
        </div>
      </Show>
      <div class="kilo-logo-layer kilo-logo-static">
        <img src={`${icons}/${file}`} alt="Kilo Code" />
      </div>
    </div>
  )
}

export function Welcome(props: {
  onSelectSession: (id: string) => void
  onShowHistory: () => void
  /** Extra content below the recent sessions, for example the Agent Manager shortcut hints and its reopen action. */
  footer?: JSX.Element
}) {
  const v2 = useV2()
  const language = useLanguage()
  const dialog = useDialog()
  const work = useWorkStyleOptional()
  const loading = () => work?.loading() ?? false
  const onboarding = () => work?.shouldShowOnboarding() ?? false
  const recent = () =>
    v2.data.session
      .list()
      .filter((item) => !item.parentID)
      .slice(0, RECENT)

  return (
    <div class="message-list-empty" classList={{ "work-style-empty": onboarding() }}>
      <KiloLogo />
      <Show
        when={!loading()}
        fallback={
          <div class="message-list-loading" role="status">
            <Spinner />
            <span>{language.t("session.messages.initializing")}</span>
          </div>
        }
      >
        <Show
          when={onboarding()}
          fallback={
            <>
              <p class="kilo-about-text">{language.t("session.messages.welcome")}</p>
              <Show when={recent().length > 0}>
                <div class="recent-sessions">
                  <span class="recent-sessions-label">{language.t("session.recent")}</span>
                  <For each={recent()}>
                    {(item) => (
                      <button class="recent-session-item" onClick={() => props.onSelectSession(item.id)}>
                        <span class="recent-session-title" dir="auto">
                          {item.title || language.t("session.untitled")}
                        </span>
                        <span class="recent-session-date">
                          {formatRelativeDate(new Date(item.time.updated).toISOString())}
                        </span>
                      </button>
                    )}
                  </For>
                  <button class="show-history-btn" onClick={() => props.onShowHistory()}>
                    <Icon name="history" size="small" />
                    {language.t("session.showHistory")}
                  </button>
                </div>
              </Show>
              <button class="feedback-button" onClick={() => dialog.show(() => <FeedbackDialog />)}>
                <Icon name="bubble-5" size="small" />
                {language.t("feedback.button")}
              </button>
              {props.footer}
            </>
          }
        >
          <h1 class="work-style-welcome">{language.t("workStyle.onboarding.welcome")}</h1>
          <WorkStylePicker />
        </Show>
      </Show>
    </div>
  )
}
