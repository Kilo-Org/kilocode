import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import * as Model from "@tui/util/model"
import { RoutedModelMeta } from "@/kilocode/cli/cmd/tui/routes/session/routed-model-meta"
import { fmtAttemptCost, fmtScore } from "@/kilocode/components/model-info-panel-utils"
import {
  formatCost,
  formatCount,
  formatRate,
  groupModelsByProvider,
  useModelUsage,
} from "@/kilocode/plugins/model-usage"

const id = "internal:kilo-sidebar-usage"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const local = useLocal()
  const { usage, unavailable } = useModelUsage(props.api, () => props.session_id)
  const providers = createMemo(() => Model.index([...props.api.state.provider]))
  const groups = createMemo(() => groupModelsByProvider(usage()?.models ?? [], props.api.state.provider))
  const bench = createMemo(() => {
    const current = local.model.current()
    if (!current) return undefined
    const provider = props.api.state.provider.find((item) => item.id === current.providerID)
    return provider?.models[current.modelID]?.terminalBench
  })
  const Row = (props: { label: string; value: string }) => (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme().textMuted}>{props.label}</text>
      <text fg={theme().textMuted}>{props.value}</text>
    </box>
  )

  return (
    <box gap={1}>
      <box>
        <text fg={theme().text}>
          <b>Token Usage</b>
        </text>
        <Show
          when={usage()}
          fallback={<text fg={theme().textMuted}>{unavailable() ? "Usage unavailable" : "Loading usage..."}</text>}
        >
          {(data) => (
            <>
              <Row label="Input" value={formatCount(data().totals.tokens.input)} />
              <Row label="Output" value={formatCount(data().totals.tokens.output)} />
              <Row label="Reasoning" value={formatCount(data().totals.tokens.reasoning)} />
              <Row label="Cache read" value={formatCount(data().totals.tokens.cache.read)} />
              <Row label="Cache write" value={formatCount(data().totals.tokens.cache.write)} />
              <Row label="Cache rate" value={formatRate(data().totals.tokens)} />
              <Row label="Cost" value={formatCost(data().totals.cost)} />
            </>
          )}
        </Show>
      </box>
      <Show when={bench()}>
        {(value) => (
          <box>
            <text fg={theme().text}>
              <b>Terminal Bench 2.0</b>
            </text>
            <Row label="Completion" value={fmtScore(value().overallScore)} />
            <Row label="Cost / attempt" value={fmtAttemptCost(value().avgAttemptCostUsd)} />
          </box>
        )}
      </Show>
      <Show when={usage()}>
        {(data) => (
          <box>
            <text fg={theme().text}>
              <b>Models ({data().models.length})</b>
            </text>
            <Show when={data().models.length > 0} fallback={<text fg={theme().textMuted}>No model usage yet</text>}>
              <box gap={1}>
                <For each={groups()}>
                  {(group) => (
                    <box>
                      <text fg={theme().text}>
                        <b>{group.providerName}</b>
                      </text>
                      <box gap={1} paddingLeft={1}>
                        <For each={group.models}>
                          {(model) => (
                            <box>
                              <text fg={theme().text} wrapMode="char">
                                <b>{RoutedModelMeta.label(providers(), model)}</b>
                              </text>
                              <text fg={theme().textMuted} wrapMode="word">
                                Steps {formatCount(model.steps)} | Cost {formatCost(model.cost)}
                              </text>
                              <text fg={theme().textMuted} wrapMode="word">
                                In {formatCount(model.tokens.input)} | Out {formatCount(model.tokens.output)} | Reason{" "}
                                {formatCount(model.tokens.reasoning)}
                              </text>
                              <text fg={theme().textMuted} wrapMode="word">
                                Cache R {formatCount(model.tokens.cache.read)} | W{" "}
                                {formatCount(model.tokens.cache.write)} | Rate {formatRate(model.tokens)}
                              </text>
                            </box>
                          )}
                        </For>
                      </box>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>
        )}
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
