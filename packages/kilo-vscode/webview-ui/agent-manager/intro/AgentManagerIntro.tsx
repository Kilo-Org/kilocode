import { Show, createSignal, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { useLanguage } from "../../src/context/language"
import { useVSCode } from "../../src/context/vscode"
import { WelcomeEmptyState, KiloLogo } from "../../src/components/chat/WelcomeEmptyState"
import { IntroGraph } from "./IntroGraph"
import "./intro.css"

interface IntroProps {
  base: string
  git: boolean
  onCreateWorktree: () => void
  onDismiss: () => void
}

export function createIntro(opts: {
  base: () => string
  git: () => boolean
  onCreateWorktree: () => void
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  reveal: () => void
  focus: () => void
}) {
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
  return {
    ...state,
    render: (): JSX.Element => (
      <AgentManagerEmptyState
        base={opts.base()}
        git={opts.git()}
        intro={state}
        onCreateWorktree={opts.onCreateWorktree}
        onSelectSession={opts.onSelectSession}
        onShowHistory={opts.onShowHistory}
      />
    ),
  }
}

interface EmptyProps extends Omit<IntroProps, "onDismiss"> {
  intro: Pick<ReturnType<typeof createIntro>, "visible" | "open" | "dismiss">
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
}

function AgentManagerEmptyState(props: EmptyProps) {
  const { t } = useLanguage()
  return (
    <Show
      when={props.intro.visible()}
      fallback={
        <WelcomeEmptyState
          onSelectSession={props.onSelectSession}
          onShowHistory={props.onShowHistory}
          footer={
            <Button
              variant="ghost"
              size="small"
              icon="help"
              data-action="agent-manager-intro"
              onClick={props.intro.open}
            >
              {t("agentManager.intro.reopen")}
            </Button>
          }
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
          <h3>{t("agentManager.intro.graph.conflict")}</h3>
          <p>{t("agentManager.intro.conflictText")}</p>
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
          triggerProps={{ variant: "ghost", size: "small", icon: "help", class: "am-intro-help" }}
          trigger={t("agentManager.intro.graph.conflict")}
          title={t("agentManager.intro.graph.conflict")}
        >
          <div class="am-intro-tip-body">
            <p>{t("agentManager.intro.conflictText")}</p>
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
