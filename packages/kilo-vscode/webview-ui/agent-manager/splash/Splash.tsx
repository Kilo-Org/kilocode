import { For, Show, createSignal, createUniqueId, type Accessor, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { WelcomeEmptyState, KiloLogo } from "../../src/components/chat/WelcomeEmptyState"
import { useLanguage } from "../../src/context/language"
import type { SessionInfo } from "../../src/types/messages"
import { examples } from "./examples"
import { Cards } from "./Cards"
import { Compact } from "./Compact"
import { Preview } from "./Preview"
import "./splash.css"

/** Every example's numbered features share one grid cell, so the height never changes. */
function Features(props: { selected: Accessor<number>; onHover: (index: number | undefined) => void }) {
  const { t } = useLanguage()
  return (
    <div class="am-splash-feature-stack">
      <For each={examples}>
        {(example, index) => (
          <ul
            class="am-splash-features"
            classList={{ "am-splash-features-active": index() === props.selected() }}
            data-tone={example.id}
            aria-hidden={index() !== props.selected() ? "true" : undefined}
          >
            <For each={example.features}>
              {(feature, position) => (
                <li
                  class="am-splash-feature"
                  onMouseEnter={() => props.onHover(position())}
                  onMouseLeave={() => props.onHover(undefined)}
                >
                  <span class="am-splash-feature-marker" aria-hidden="true">
                    {position() + 1}
                  </span>
                  <span class="am-splash-feature-text">
                    <strong>{t(feature.name)}</strong>
                    <span class="am-splash-feature-description">{t(feature.text)}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        )}
      </For>
    </div>
  )
}

export function SplashExpanded(props: {
  /** Worktrees need git, so outside a repository the splash explains that instead of offering one. */
  git: boolean
  onHide: () => void
  onCompose: () => void
  onCreateWorktree: () => void
  initialExample?: number
}) {
  const { t } = useLanguage()
  const title = createUniqueId()
  const [selected, setSelected] = createSignal(props.initialExample ?? 0)
  const [hover, setHover] = createSignal<number>()
  const example = () => examples.at(selected())!
  const select = (index: number) => {
    setSelected(index)
    setHover(undefined)
  }
  return (
    <section class="am-splash" aria-labelledby={title}>
      <article class="am-splash-hero">
        <header class="am-splash-header">
          <div class="am-splash-logo" aria-hidden="true">
            <KiloLogo />
          </div>
          <span class="am-splash-eyebrow">{t("agentManager.splash.eyebrow")}</span>
          <Button
            variant="ghost"
            size="small"
            class="am-splash-hide"
            aria-label={t("agentManager.splash.hideLabel")}
            onClick={props.onHide}
          >
            {t("agentManager.splash.hide")}
          </Button>
        </header>
        <h2 class="am-splash-title" id={title}>
          {t("agentManager.splash.title")}
        </h2>
        {/* Container queries show one subtitle and one picker for the layout mode. */}
        <p class="am-splash-subtitle am-splash-subtitle-wide">{t("agentManager.splash.subtitle")}</p>
        <p class="am-splash-subtitle am-splash-subtitle-compact">{t("agentManager.splash.compact.subtitle")}</p>
        <Cards selected={selected} onSelect={select} />
        <Compact selected={selected} onSelect={select} />
        <Features selected={selected} onHover={setHover} />
        <div class="am-splash-actions">
          <Show when={props.git} fallback={<p>{t("agentManager.setup.error.not_git_repo")}</p>}>
            <Button variant="primary" onClick={props.onCreateWorktree}>
              {t("agentManager.dialog.createWorktree")}
            </Button>
          </Show>
          <span class="am-splash-hint">
            {t("agentManager.splash.hint")}{" "}
            <button type="button" class="am-splash-proceed" onClick={props.onCompose}>
              {t("agentManager.splash.proceed")}
            </button>
          </span>
        </div>
        <Preview selected={selected} hover={hover} />
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {t(example().title)} — {t(example().pitch)}
        </div>
      </article>
    </section>
  )
}

type Welcome = {
  sessions?: () => SessionInfo[]
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  hints?: () => JSX.Element
}

/** The welcome list with the intro's reopen button, shown after a legacy Skip or a splash Hide. */
export function Reopen(props: Welcome & { onOpen: () => void }) {
  const { t } = useLanguage()
  return (
    <WelcomeEmptyState
      sessions={props.sessions}
      onSelectSession={props.onSelectSession}
      onShowHistory={props.onShowHistory}
      footer={
        <>
          {props.hints?.()}
          <Button variant="ghost" size="small" icon="help" data-action="agent-manager-intro" onClick={props.onOpen}>
            {t("agentManager.intro.reopen")}
          </Button>
        </>
      }
    />
  )
}

export function SplashFolded(props: Welcome & { onShowExamples: () => void }) {
  const { t } = useLanguage()
  return (
    <div class="am-splash-folded-layout">
      <div class="am-splash-folded" role="region" aria-label={t("agentManager.splash.folded.title")}>
        <div class="am-splash-folded-logo" aria-hidden="true">
          <KiloLogo />
        </div>
        <span class="am-splash-folded-title">{t("agentManager.splash.folded.title")}</span>
        <span class="am-splash-folded-note" title={t("agentManager.splash.folded.note")}>
          {t("agentManager.splash.folded.note")}
        </span>
        <Button variant="ghost" size="small" class="am-splash-show" onClick={props.onShowExamples}>
          {t("agentManager.splash.showExamples")}
          <Icon name="chevron-right" size="small" />
        </Button>
      </div>
      <div class="am-splash-folded-body">
        <WelcomeEmptyState
          sessions={props.sessions}
          onSelectSession={props.onSelectSession}
          onShowHistory={props.onShowHistory}
          footer={props.hints?.()}
        />
      </div>
    </div>
  )
}
