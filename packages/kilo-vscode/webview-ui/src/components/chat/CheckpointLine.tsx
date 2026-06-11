import { Component, Show, createMemo } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"

interface CheckpointLineProps {
  snapshot?: string
  busy: boolean
  parallel: boolean
  tools: number
  loading: boolean
  onRewind: () => void
  onViewDiff?: () => void
}

export const CheckpointLine: Component<CheckpointLineProps> = (props) => {
  const language = useLanguage()
  const label = createMemo(() => {
    if (props.busy) return language.t("checkpoint.stopRewind")
    if (props.parallel) return language.t("checkpoint.parallel", { count: props.tools })
    return language.t("checkpoint.label")
  })
  const title = createMemo(() => (props.snapshot ? label() : language.t("checkpoint.unavailable")))

  return (
    <div data-component="checkpoint-line" data-unavailable={!props.snapshot ? "" : undefined}>
      <span data-slot="checkpoint-rule" />
      <Button
        data-slot="checkpoint-action"
        variant="ghost"
        size="small"
        disabled={!props.snapshot || props.loading}
        aria-busy={props.loading}
        onClick={() => props.snapshot && !props.loading && props.onRewind()}
        title={title()}
      >
        <Show when={props.loading} fallback={<Icon name="history" size="small" />}>
          <Spinner data-slot="checkpoint-spinner" />
        </Show>
        <span>{label()}</span>
      </Button>
      <Show when={props.onViewDiff}>
        {(view) => (
          <Tooltip value={language.t("checkpoint.viewChanges")} placement="top">
            <Button
              data-slot="checkpoint-diff"
              variant="ghost"
              size="small"
              onClick={view()}
              aria-label={language.t("checkpoint.viewChanges")}
            >
              <Icon name="review" size="small" />
            </Button>
          </Tooltip>
        )}
      </Show>
      <span data-slot="checkpoint-rule" />
    </div>
  )
}
