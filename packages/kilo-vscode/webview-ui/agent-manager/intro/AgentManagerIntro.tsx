import { Show, createSignal, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { useLanguage } from "../../src/context/language"
import { useVSCode } from "../../src/context/vscode"
import { useConfig } from "../../src/context/config"
import type { SessionInfo } from "../../src/types/messages"
import { KiloLogo } from "../../src/components/chat/WelcomeEmptyState"
import { createSplashIntro } from "../splash"
import { Reopen } from "../splash/Splash"
import { IntroGraph } from "./IntroGraph"
import "./intro.css"

interface IntroProps {
  base: string
  git: boolean
  onCreateWorktree: () => void
  onDismiss: () => void
}

export interface IntroOptions {
  base: () => string
  git: () => boolean
  sessions?: () => SessionInfo[]
  onCreateWorktree: () => void
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  reveal: () => void
  focus: () => void
  /** Focuses the local prompt. */
  compose: () => void
  hints?: () => JSX.Element
}

export interface Intro {
  visible: () => boolean
  dismiss: () => void
  render: () => JSX.Element
  /** Called when the first root session is accepted. */
  started: () => void
}

export function createIntro(opts: IntroOptions): Intro {
  const config = useConfig()
  const splash = createSplashIntro(opts)
  const enabled = () => config.settings().agentManagerSplash === true
  const vscode = useVSCode()
  const [dismissed, setDismissed] = createSignal(
    (window as { KILO_AGENT_MANAGER_INTRO_DISMISSED?: boolean }).KILO_AGENT_MANAGER_INTRO_DISMISSED === true,
  )
  const save = (value: boolean) => {
    setDismissed(value)
    vscode.postMessage({ type: "agentManager.setIntroDismissed", dismissed: value })
  }
  const state = {
    visible: () => !dismissed(),
    open: () => {
      opts.reveal()
      save(false)
      opts.focus()
    },
    dismiss: () => {
      save(true)
      opts.focus()
    },
  }
  const legacy: Intro = {
    ...state,
    started: () => {},
    render: (): JSX.Element => (
      <AgentManagerEmptyState
        base={opts.base()}
        git={opts.git()}
        sessions={opts.sessions}
        intro={state}
        onCreateWorktree={opts.onCreateWorktree}
        onSelectSession={opts.onSelectSession}
        onShowHistory={opts.onShowHistory}
        hints={opts.hints}
      />
    ),
  }
  const current = () => (enabled() ? splash : legacy)
  return {
    visible: () => current().visible(),
    dismiss: () => current().dismiss(),
    started: () => current().started(),
    render: () => (
      <Show when={enabled()} fallback={legacy.render()}>
        {splash.render()}
      </Show>
    ),
  }
}

interface EmptyProps extends Omit<IntroProps, "onDismiss"> {
  intro: { visible: () => boolean; open: () => void; dismiss: () => void }
  sessions?: () => SessionInfo[]
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  hints?: () => JSX.Element
}

function AgentManagerEmptyState(props: EmptyProps) {
  return (
    <Show
      when={props.intro.visible()}
      fallback={
        <Reopen
          sessions={props.sessions}
          onSelectSession={props.onSelectSession}
          onShowHistory={props.onShowHistory}
          hints={props.hints}
          onOpen={props.intro.open}
        />
      }
    >
      <Introduction {...props} onDismiss={props.intro.dismiss} />
    </Show>
  )
}

function Introduction(props: IntroProps) {
  const { t } = useLanguage()
  const vscode = useVSCode()
  return (
    <section class="am-intro">
      <header class="am-intro-heading">
        <div class="am-intro-logo" aria-hidden="true">
          <KiloLogo />
        </div>
        <h2 class="am-intro-title">{t("agentManager.intro.title")}</h2>
      </header>
      <p class="am-intro-subtitle">{t("agentManager.intro.subtitle")}</p>
      <IntroGraph base={props.base} />
      <div class="am-intro-actions">
        <Show when={props.git} fallback={<p>{t("agentManager.setup.error.not_git_repo")}</p>}>
          <Button variant="primary" icon="branch" onClick={props.onCreateWorktree}>
            {t("agentManager.intro.create")}
          </Button>
        </Show>
        <Button variant="ghost" onClick={props.onDismiss}>
          {t("agentManager.intro.dismiss")}
        </Button>
      </div>
      <div class="am-intro-details">
        <div class="am-intro-detail">
          <h3>{t("agentManager.intro.stage4.title")}</h3>
          <p>{t("agentManager.intro.stage4.text")}</p>
        </div>
        <div class="am-intro-detail">
          <h3>
            {t("agentManager.intro.updateTitle")} <code class="am-intro-command">/update-from-base</code>
          </h3>
          <p>{t("agentManager.intro.updateText")}</p>
        </div>
      </div>
      <div class="am-intro-footer">
        <Popover
          placement="top-start"
          class="am-intro-tip"
          triggerAs={Button}
          triggerProps={{ variant: "ghost", size: "small", icon: "branch", class: "am-intro-help" }}
          trigger={t("agentManager.intro.stage4.title")}
          title={t("agentManager.intro.stage4.title")}
        >
          <div class="am-intro-tip-body">
            <p>{t("agentManager.intro.stage4.text")}</p>
          </div>
        </Popover>
        <Popover
          placement="top-start"
          class="am-intro-tip"
          triggerAs={Button}
          triggerProps={{ variant: "ghost", size: "small", icon: "branch", class: "am-intro-help" }}
          trigger={
            <span>
              {t("agentManager.intro.updateTitle")} <code class="am-intro-command">/update-from-base</code>
            </span>
          }
          title={t("agentManager.intro.updateTitle")}
        >
          <div class="am-intro-tip-body">
            <p>{t("agentManager.intro.updateText")}</p>
          </div>
        </Popover>
        <Button
          variant="ghost"
          size="small"
          icon="link"
          onClick={() => {
            vscode.postMessage({ type: "openExternal", url: "https://kilo.ai/docs/automate/agent-manager-workflows" })
          }}
        >
          {t("agentManager.intro.guide")}
        </Button>
      </div>
    </section>
  )
}
