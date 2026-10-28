// main's sidebar empty state (components/chat/WelcomeEmptyState.tsx) on v2 sessions.
import { Icon } from "@kilocode/kilo-ui/icon"
import { createSignal, For, Show } from "solid-js"
import { AnimatedKiloLogo, reduced } from "../components/brand/AnimatedKiloLogo"
import { useLanguage } from "../context/language"
import { formatRelativeDate } from "../utils/date"
import { useV2 } from "./client"

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

export function Welcome(props: { onSelectSession: (id: string) => void; onShowHistory: () => void }) {
  const v2 = useV2()
  const language = useLanguage()
  const recent = () => v2.data.session.list().filter((item) => !item.parentID).slice(0, RECENT)

  return (
    <div class="message-list-empty">
      <KiloLogo />
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
                <span class="recent-session-date">{formatRelativeDate(new Date(item.time.updated).toISOString())}</span>
              </button>
            )}
          </For>
          <button class="show-history-btn" onClick={() => props.onShowHistory()}>
            <Icon name="history" size="small" />
            {language.t("session.showHistory")}
          </button>
        </div>
      </Show>
    </div>
  )
}
