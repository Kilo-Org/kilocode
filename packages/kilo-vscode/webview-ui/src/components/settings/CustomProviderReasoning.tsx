import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { For } from "solid-js"
import { REASONING_EFFORTS, type ReasoningEffort } from "../../../../src/shared/custom-provider"

type Props = {
  values: readonly ReasoningEffort[]
  onChange: (values: ReasoningEffort[]) => void
  t: (key: string) => string
  label: string
}

export function ReasoningEfforts(props: Props) {
  function change(effort: ReasoningEffort, checked: boolean) {
    const values = checked ? [...props.values, effort] : props.values.filter((value) => value !== effort)
    props.onChange(REASONING_EFFORTS.filter((value) => values.includes(value)))
  }

  return (
    <div role="group" aria-label={props.label} style={{ display: "flex", "flex-wrap": "wrap", gap: "8px 16px" }}>
      <For each={REASONING_EFFORTS}>
        {(effort) => (
          <Checkbox checked={props.values.includes(effort)} onChange={(checked) => change(effort, checked)}>
            {props.t(`provider.custom.reasoning.effort.${effort}`)}
          </Checkbox>
        )}
      </For>
    </div>
  )
}
