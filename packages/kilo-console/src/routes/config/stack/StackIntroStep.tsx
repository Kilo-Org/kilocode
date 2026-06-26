import type { StackWizard } from "../state/stack"

export function StackIntroStep(props: { state: StackWizard }) {
  return (
    <section class="stack-step" aria-labelledby="stack-intro-title">
      <div class="stack-step-heading">
        <p class="eyebrow">Project stack</p>
        <h2 id="stack-intro-title" data-stack-focus tabIndex={-1}>
          Configure your project stack
        </h2>
        <p>
          Scan this project for the technologies it already uses, or pick them by hand. You can adjust any selection
          before applying managed Skills and MCP servers.
        </p>
      </div>

      <div class="stack-verticals stack-intro-choices">
        <button class="stack-vertical-card" type="button" onClick={() => void props.state.detect()}>
          <span class="stack-vertical-mark" aria-hidden="true">
            AD
          </span>
          <span class="stack-vertical-copy">
            <strong>Auto-detect technologies</strong>
            <small>Scan package manifests and project files, then review what was found.</small>
          </span>
        </button>
        <button class="stack-vertical-card" type="button" onClick={props.state.goManual}>
          <span class="stack-vertical-mark" aria-hidden="true">
            MA
          </span>
          <span class="stack-vertical-copy">
            <strong>Select manually</strong>
            <small>Choose a vertical and tick the technologies this project uses.</small>
          </span>
        </button>
      </div>
    </section>
  )
}
