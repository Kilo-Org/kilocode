import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import * as Model from "@tui/util/model"
import { Locale } from "@/util/locale"
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
  const [usageOpen, setUsageOpen] = createSignal(true)
  const [modelsOpen, setModelsOpen] = createSignal(true)
  const [benchOpen, setBenchOpen] = createSignal(true)
  const [expanded, setExpanded] = createSignal(new Set<string>())
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
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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

  return (
    <box gap={1}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setUsageOpen((open) => !open)}>
          <text fg={theme().text}>{usageOpen() ? "▼" : "▶"}</text>
          <text fg={theme().text}>
            <b>Token Usage</b>
          </text>
        </box>
        <Show when={usageOpen()}>
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
        </Show>
      </box>
      <Show when={usage()}>
        {(data) => (
          <box>
            <box flexDirection="row" gap={1} onMouseDown={() => setModelsOpen((open) => !open)}>
              <text fg={theme().text}>{modelsOpen() ? "▼" : "▶"}</text>
              <text fg={theme().text}>
                <b>Models ({data().models.length})</b>
              </text>
            </box>
            <Show when={modelsOpen()}>
              <Show when={data().models.length > 0} fallback={<text fg={theme().textMuted}>No model usage yet</text>}>
                <box gap={1} paddingTop={1}>
                  <For each={groups()}>
                    {(group) => (
                      <box gap={1}>
                        <text fg={theme().text}>
                          <b>{group.providerName}</b>
                        </text>
                        <box>
                          <box flexDirection="row" gap={1}>
                            <box width={1} flexShrink={0} />
                            <text fg={theme().textMuted} flexGrow={1} minWidth={0} wrapMode="none">
                              Model
                            </text>
                            <box width={5} flexDirection="row" flexShrink={0} justifyContent="flex-end">
                              <text fg={theme().textMuted}>Steps</text>
                            </box>
                            <box width={9} flexDirection="row" flexShrink={0} justifyContent="flex-end">
                              <text fg={theme().textMuted}>Cost</text>
                            </box>
                          </box>
                          <For each={group.models}>
                            {(model) => {
                              const key = `${props.session_id}/${model.providerID}/${model.modelID}`
                              return (
                                <box>
                                  <box flexDirection="row" gap={1} onMouseDown={() => toggle(key)}>
                                    <text fg={theme().text} flexShrink={0}>
                                      {expanded().has(key) ? "▼" : "▶"}
                                    </text>
                                    <box flexGrow={1} minWidth={0} overflow="hidden">
                                      <text fg={theme().text} wrapMode="none">
                                        <b>
                                          {Locale.truncate(
                                            RoutedModelMeta.label(providers(), model) ?? model.modelID,
                                            19,
                                          )}
                                        </b>
                                      </text>
                                    </box>
                                    <box width={5} flexDirection="row" flexShrink={0} justifyContent="flex-end">
                                      <text fg={theme().textMuted}>{formatCount(model.steps)}</text>
                                    </box>
                                    <box width={9} flexDirection="row" flexShrink={0} justifyContent="flex-end">
                                      <text fg={theme().textMuted}>{formatCost(model.cost)}</text>
                                    </box>
                                  </box>
                                  <Show when={expanded().has(key)}>
                                    <box paddingLeft={2}>
                                      <Row label="Input" value={formatCount(model.tokens.input)} />
                                      <Row label="Output" value={formatCount(model.tokens.output)} />
                                      <Row label="Reasoning" value={formatCount(model.tokens.reasoning)} />
                                      <Row label="Cache read" value={formatCount(model.tokens.cache.read)} />
                                      <Row label="Cache write" value={formatCount(model.tokens.cache.write)} />
                                      <Row label="Cache rate" value={formatRate(model.tokens)} />
                                    </box>
                                  </Show>
                                </box>
                              )
                            }}
                          </For>
                        </box>
                      </box>
                    )}
                  </For>
                </box>
              </Show>
            </Show>
          </box>
        )}
      </Show>
      <Show when={bench()}>
        {(value) => (
          <box>
            <box flexDirection="row" gap={1} onMouseDown={() => setBenchOpen((open) => !open)}>
              <text fg={theme().text}>{benchOpen() ? "▼" : "▶"}</text>
              <text fg={theme().text}>
                <b>Terminal Bench 2.0</b>
              </text>
            </box>
            <Show when={benchOpen()}>
              <Row label="Completion" value={fmtScore(value().overallScore)} />
              <Row label="Cost / attempt" value={fmtAttemptCost(value().avgAttemptCostUsd)} />
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
