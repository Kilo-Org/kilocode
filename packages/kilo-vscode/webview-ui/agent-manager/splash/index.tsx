import { Show } from "solid-js"
import { useVSCode } from "../../src/context/vscode"
import type { Intro, IntroOptions } from "../intro/AgentManagerIntro"
import { createFold } from "./fold"
import { Reopen, SplashExpanded, SplashFolded } from "./Splash"

/** The experimental splash intro. Hide dismisses it; the first accepted session folds it once. */
export function createSplashIntro(
  opts: IntroOptions,
  folded = (window as { KILO_AGENT_MANAGER_SPLASH_FOLDED?: boolean }).KILO_AGENT_MANAGER_SPLASH_FOLDED,
  dismissed = (window as { KILO_AGENT_MANAGER_INTRO_DISMISSED?: boolean }).KILO_AGENT_MANAGER_INTRO_DISMISSED,
): Intro {
  const fold = createFold(useVSCode(), folded, dismissed)
  const hide = () => {
    fold.hide()
    opts.focus()
  }
  const show = () => {
    fold.show()
    opts.focus()
  }
  // Like the legacy intro's reopen, bring the empty chat forward first.
  const reopen = () => {
    opts.reveal()
    show()
  }
  return {
    visible: () => !fold.hidden() && !fold.folded(),
    dismiss: hide,
    started: fold.started,
    render: () => (
      <Show
        when={!fold.hidden()}
        fallback={
          <Reopen
            sessions={opts.sessions}
            onSelectSession={opts.onSelectSession}
            onShowHistory={opts.onShowHistory}
            hints={opts.hints}
            onOpen={reopen}
          />
        }
      >
        <Show
          when={!fold.folded()}
          fallback={
            <SplashFolded
              sessions={opts.sessions}
              onSelectSession={opts.onSelectSession}
              onShowHistory={opts.onShowHistory}
              hints={opts.hints}
              onShowExamples={show}
            />
          }
        >
          <SplashExpanded
            git={opts.git()}
            onHide={hide}
            onCompose={opts.compose}
            onCreateWorktree={opts.onCreateWorktree}
          />
        </Show>
      </Show>
    ),
  }
}
