import { Show, createSignal, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { useLanguage } from "../../src/context/language"
import { useBridge } from "../v2/vscode"
import { useV2Optional } from "../../src/v2/client"
import { KiloLogo, Welcome } from "../../src/v2/welcome"
import { IntroGraph } from "./IntroGraph"
import "./intro.css"

interface IntroProps {
  base: string
  git: boolean
  onCreateWorktree: () => void
  onDismiss: () => void
}

/**
 * The Agent Manager welcome. The v2 welcome already lists the recent sessions of the open directory, so the Agent
 * Manager intro only wraps it with its own introduction, hints and reopen action.
 */
export function createIntro(opts: {
  base: () => string
  git: () => boolean
  onCreateWorktree: () => void
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  reveal: () => void
  focus: () => void
  hints?: () => JSX.Element
}) {
  const vscode = useBridge()
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
  /** The dismissed state: the shared welcome, the shortcut hints and the way back to the intro. */
  const fallback = (): JSX.Element => (
    <Welcome
      onSelectSession={(id) => opts.onSelectSession?.(id)}
      onShowHistory={() => opts.onShowHistory?.()}
      footer={
        <>
          {opts.hints?.()}
          <Reopen onClick={state.open} />
        </>
      }
    />
  )
  return {
    ...state,
    render: (): JSX.Element => (
      <AgentManagerIntro
        base={opts.base()}
        git={opts.git()}
        intro={state}
        fallback={fallback}
        onCreateWorktree={opts.onCreateWorktree}
        onDismiss={state.dismiss}
      />
    ),
    fallback,
  }
}

interface IntroState {
  visible: () => boolean
  open: () => void
  dismiss: () => void
}

function AgentManagerIntro(props: IntroProps & { intro: IntroState; fallback: () => JSX.Element }) {
  const scope = useV2Optional()
  return (
    <Show
      when={props.intro.visible()}
      fallback={
        <Show when={scope} fallback={<Reopen onClick={props.intro.open} />}>
          {props.fallback()}
        </Show>
      }
    >
      <Introduction {...props} />
    </Show>
  )
}

function Reopen(props: { onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <Button variant="ghost" size="small" icon="help" data-action="agent-manager-intro" onClick={() => props.onClick()}>
      {t("agentManager.intro.reopen")}
    </Button>
  )
}

function Introduction(props: IntroProps) {
  const { t } = useLanguage()
  const vscode = useBridge()
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
            vscode.postMessage({ type: "open", url: "https://kilo.ai/docs/automate/agent-manager-workflows" })
          }}
        >
          {t("agentManager.intro.guide")}
        </Button>
      </div>
    </section>
  )
}
