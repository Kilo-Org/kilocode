import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createEffect, createMemo, createResource, For, on, onCleanup, onMount, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import * as Model from "@tui/util/model"
import { RoutedModelMeta } from "@/kilocode/cli/cmd/tui/routes/session/routed-model-meta"
import { fmtAttemptCost, fmtScore } from "@/kilocode/components/model-info-panel-utils"
import {
  failed,
  formatCost,
  formatCount,
  formatRate,
  groupModelsByProvider,
  isSessionTreeMember,
  select,
  type UsageResult,
} from "@/kilocode/plugins/model-usage"

const id = "internal:kilo-sidebar-usage"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const local = useLocal()
  const [result, { refetch }] = createResource(
    () => props.session_id,
    (sessionID): Promise<UsageResult> =>
      props.api.client.kilocode.sessionModelUsage({ sessionID }).then(
        (response) => ({ sessionID, data: response.data }),
        () => ({ sessionID }),
      ),
  )
  const usage = createMemo(() => select(result(), props.session_id))
  const unavailable = createMemo(() => failed(result(), props.session_id))
  const stamp = createMemo(() =>
    props.api.state.session.messages(props.session_id).reduce((sum, item) => {
      if (item.role !== "assistant") return sum
      return (
        sum +
        (item.cost ?? 0) +
        item.tokens.input +
        item.tokens.output +
        item.tokens.reasoning +
        item.tokens.cache.read +
        item.tokens.cache.write
      )
    }, 0),
  )
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

  onMount(() => {
    const refresh = () => void refetch()
    const related = (sessionID: string, info?: ReturnType<typeof props.api.state.session.get>) =>
      isSessionTreeMember({ root: props.session_id, sessionID, info, get: props.api.state.session.get })
    const offs = [
      props.api.event.on("message.part.updated", (event) => {
        if (event.properties.part.type === "step-finish" && related(event.properties.sessionID)) refresh()
      }),
      props.api.event.on("message.part.removed", (event) => {
        if (related(event.properties.sessionID)) refresh()
      }),
      props.api.event.on("message.removed", (event) => {
        if (related(event.properties.sessionID)) refresh()
      }),
      props.api.event.on("session.created", (event) => {
        if (related(event.properties.sessionID, event.properties.info)) refresh()
      }),
      props.api.event.on("session.deleted", (event) => {
        if (related(event.properties.sessionID, event.properties.info)) refresh()
      }),
      props.api.event.on("server.connected", refresh),
    ]
    onCleanup(() => {
      for (const off of offs) off()
    })
  })

  createEffect(on(stamp, () => void refetch(), { defer: true }))

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
