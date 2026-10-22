import type { Component } from "solid-js"
import { Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { formatCompactCount } from "../../utils/format"

interface TaskUsageProps {
  tokens: { input: number; output: number; cached: number }
}

export const TaskUsage: Component<TaskUsageProps> = (props) => (
  <div class="task-header-tokens">
    <span class="task-header-tokens-label">Tokens</span>
    <Show when={props.tokens.input > 0}>
      <span class="task-header-tokens-value">
        <Icon name="arrow-up" size="small" />
        {formatCompactCount(props.tokens.input)}
      </span>
    </Show>
    <Show when={props.tokens.cached > 0}>
      <span class="task-header-tokens-value">
        <Icon name="arrow-up" size="small" />
        cache {formatCompactCount(props.tokens.cached)}
      </span>
    </Show>
    <Show when={props.tokens.output > 0}>
      <span class="task-header-tokens-value">
        <Icon name="arrow-down-to-line" size="small" />
        {formatCompactCount(props.tokens.output)}
      </span>
    </Show>
  </div>
)
