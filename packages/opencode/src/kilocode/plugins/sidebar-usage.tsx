import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import * as Model from "@tui/util/model"
import { Locale } from "@/util/locale"
import { RoutedModelMeta } from "@/kilocode/cli/cmd/tui/routes/session/routed-model-meta"
import { fmtAttemptCost, fmtScore } from "@/kilocode/components/model-info-panel-utils"
import {
  aggregateMetrics,
  failed,
  formatCost,
  formatCount,
  formatRate,
  formatRateValue,
  groupModelsByProvider,
  hasMetrics,
  isSessionTreeMember,
  select,
  throughputLabel,
  type StepMetrics,
  type UsageResult,
} from "@/kilocode/plugins/model-usage"
import { ModelRow, UsageRow } from "@/kilocode/plugins/sidebar-usage-row"

const id = "internal:kilo-sidebar-usage"

type MetricSample = { metrics?: StepMetrics; generated: number }

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [usageOpen, setUsageOpen] = createSignal(true)
  const [modelsOpen, setModelsOpen] = createSignal(true)
  const [benchOpen, setBenchOpen] = createSignal(true)
  const [expanded, setExpanded] = createSignal(new Set<string>())
  const [samples, setSamples] = createSignal<MetricSample[]>([])
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
  const throughput = createMemo(() => aggregateMetrics(samples()))
  const bench = createMemo(() => {
    const current = local.model.current()
    if (!current) return undefined
    const provider = props.api.state.provider.find((item) => item.id === current.providerID)
    return provider?.models[current.modelID]?.terminalBench
  })
  const Row = (props: { label: string; value: string }) => (
    <UsageRow label={props.label} value={props.value} color={theme().textMuted} />
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
    const recordSample = (sessionID: string, part: { type?: string; metrics?: unknown; tokens?: unknown }) => {
      if (part.type !== "step-finish") return
      if (!related(sessionID)) return
      const metrics = isStepMetrics(part.metrics) ? part.metrics : undefined
      const generated = generatedTokens(part.tokens)
      setSamples((current) => [...current, { ...(metrics ? { metrics } : {}), generated }])
    }
    const offs = [
      props.api.event.on("message.part.updated", (event) => {
        recordSample(event.properties.sessionID, event.properties.part)
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
                <Show when={hasMetrics(throughput())}>
                  <Row label={throughputLabel.prompt} value={formatRateValue(throughput().prompt)} />
                  <Row label={throughputLabel.generation} value={formatRateValue(throughput().generation)} />
                </Show>
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
                                  <ModelRow
                                    label={Locale.truncate(
                                      RoutedModelMeta.label(providers(), model) ?? model.modelID,
                                      19,
                                    )}
                                    steps={formatCount(model.steps)}
                                    cost={formatCost(model.cost)}
                                    expanded={expanded().has(key)}
                                    text={theme().text}
                                    muted={theme().textMuted}
                                    toggle={() => toggle(key)}
                                  />
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

function isStepMetrics(value: unknown): value is StepMetrics {
  if (!value || typeof value !== "object") return false
  const source = (value as { source?: unknown }).source
  return source === "computed"
}

function generatedTokens(value: unknown): number {
  if (!value || typeof value !== "object") return 0
  const record = value as Record<string, unknown>
  const output = typeof record.output === "number" ? record.output : 0
  const reasoning = typeof record.reasoning === "number" ? record.reasoning : 0
  return output + reasoning
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
