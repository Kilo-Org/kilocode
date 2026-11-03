import { Show } from "solid-js"
import { useVSCode } from "../../src/context/vscode"
import type { Intro, IntroOptions } from "../intro/AgentManagerIntro"
import { createFold } from "./fold"
import { SplashExpanded, SplashFolded } from "./Splash"

/** The splash intro, behind `gate.ts`. Hide folds it; the first accepted session folds it once. */
export function createSplashIntro(
  opts: IntroOptions,
  folded = (window as { KILO_AGENT_MANAGER_SPLASH_FOLDED?: boolean }).KILO_AGENT_MANAGER_SPLASH_FOLDED,
): Intro {
  const fold = createFold(useVSCode(), folded)
  const hide = () => {
    fold.fold()
    opts.focus()
  }
  const show = () => {
    fold.unfold()
    opts.focus()
  }
  return {
    visible: () => !fold.folded(),
    dismiss: hide,
    started: fold.started,
    render: () => (
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
    ),
  }
}
