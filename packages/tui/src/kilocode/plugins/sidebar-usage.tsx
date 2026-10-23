// Kilo sidebar usage panel (order 150, between Context and MCP), as v1
// (packages/opencode/src/kilocode/plugins/sidebar-usage.tsx on main): token usage and cost of the session family,
// usage per provider and routed model, and the Terminal Bench score of the current Kilo model.
import type { SessionMessageInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLocal } from "../../context/local"
import { Locale } from "../../util/locale"
import { fmtAttemptCost, fmtScore } from "../components/model-info-panel-utils"
import { modelLabel } from "../routed-model"
import { familyUsage, formatCacheRate, formatCost, formatCount, formatSpeed } from "../usage-data"
import { cacheRate, groupModelsByProvider, modelUsage } from "./model-usage"
import { ModelRow, UsageRow } from "./sidebar-usage-row"

export function SidebarUsage(props: { context: Plugin.Context; sessionID: string }) {
  const data = props.context.data
  const theme = props.context.theme
  const local = useLocal()
  const [usageOpen, setUsageOpen] = createSignal(true)
  const [modelsOpen, setModelsOpen] = createSignal(true)
  const [benchOpen, setBenchOpen] = createSignal(true)
  const [expanded, setExpanded] = createSignal(new Set<string>())
  const root = () => data.session.root(props.sessionID)
  const family = createMemo(() => {
    const members = data.session.family(root())
    return members.includes(root()) ? members : [root(), ...members]
  })
  const location = () => data.session.get(root())?.location ?? props.context.location ?? data.location.default()
  const models = createMemo(() => data.location.model.list(location()) ?? [])
  // The message store keeps only a page of each session, so the panel reads every message of the family. A finished
  // step adds its usage to the session totals, so a change of the totals reads them again, as v1 read its usage
  // query after each step. Other session updates (title, time) do not.
  const version = createMemo(() =>
    family()
      .map((id) => {
        const session = data.session.get(id)
        return `${id}:${session?.cost ?? 0}:${JSON.stringify(session?.tokens ?? {})}`
      })
      .join(","),
  )
  const [result] = createResource(version, () =>
    Promise.all(family().map((id) => messages(props.context, id))).then(
      (list) => {
        const flat = list.flat()
        return { ...modelUsage(flat), generation: familyUsage([], flat).generation }
      },
      () => undefined,
    ),
  )
  const usage = () => result.latest
  const groups = createMemo(() =>
    groupModelsByProvider(usage()?.models ?? [], data.location.provider.list(location()) ?? []),
  )
  const [catalog] = createResource(
    () => (local.model.current()?.providerID === "kilo" ? location().directory : undefined),
    (directory) =>
      props.context.client
        .rpc(KiloGatewayRpc.Definition)
        .models({}, { location: { directory } })
        .catch(() => []),
  )
  const bench = createMemo(() => {
    const current = local.model.current()
    if (current?.providerID !== "kilo") return
    return catalog.latest?.find((entry) => entry.id === current.modelID)?.terminalBench
  })
  const Row = (row: { label: string; value: string }) => (
    <UsageRow label={row.label} value={row.value} color={theme.text.muted} />
  )
  const Header = (header: { open: boolean; toggle: () => void; title: string }) => (
    <box flexDirection="row" gap={1} onMouseDown={header.toggle}>
      <text fg={theme.text.base}>{header.open ? "▼" : "▶"}</text>
      <text fg={theme.text.base}>
        <b>{header.title}</b>
      </text>
    </box>
  )
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <box gap={1}>
      <box>
        <Header open={usageOpen()} toggle={() => setUsageOpen((open) => !open)} title="Token Usage" />
        <Show when={usageOpen()}>
          <Show
            when={usage()}
            fallback={
              <text fg={theme.text.muted}>
                {result.state === "ready" || result.state === "errored" ? "Usage unavailable" : "Loading usage..."}
              </text>
            }
          >
            {(value) => (
              <>
                <Row label="Input" value={formatCount(value().totals.tokens.input)} />
                <Row label="Output" value={formatCount(value().totals.tokens.output)} />
                <Row label="Reasoning" value={formatCount(value().totals.tokens.reasoning)} />
                <Row label="Cache read" value={formatCount(value().totals.tokens.cache.read)} />
                <Row label="Cache write" value={formatCount(value().totals.tokens.cache.write)} />
                <Row label="Cache rate" value={formatCacheRate(cacheRate(value().totals.tokens))} />
                <Show when={value().generation !== undefined}>
                  <Row label="Generation speed" value={formatSpeed(value().generation)} />
                </Show>
                <Row label="Cost" value={formatCost(value().totals.cost)} />
              </>
            )}
          </Show>
        </Show>
      </box>
      <Show when={usage()}>
        {(value) => (
          <box>
            <Header
              open={modelsOpen()}
              toggle={() => setModelsOpen((open) => !open)}
              title={`Models (${value().models.length})`}
            />
            <Show when={modelsOpen()}>
              <Show when={value().models.length > 0} fallback={<text fg={theme.text.muted}>No model usage yet</text>}>
                <box gap={1} paddingTop={1}>
                  <For each={groups()}>
                    {(group) => (
                      <box gap={1}>
                        <text fg={theme.text.base}>
                          <b>{group.providerName}</b>
                        </text>
                        <box>
                          <box flexDirection="row" gap={1}>
                            <box width={1} flexShrink={0} />
                            <text fg={theme.text.muted} flexGrow={1} minWidth={0} wrapMode="none">
                              Model
                            </text>
                            <box width={5} flexDirection="row" flexShrink={0} justifyContent="flex-end">
                              <text fg={theme.text.muted}>Steps</text>
                            </box>
                            <box width={9} flexDirection="row" flexShrink={0} justifyContent="flex-end">
                              <text fg={theme.text.muted}>Cost</text>
                            </box>
                          </box>
                          <For each={group.models}>
                            {(model) => {
                              const key = `${model.providerID}/${model.modelID}`
                              return (
                                <box>
                                  <ModelRow
                                    label={Locale.truncate(
                                      modelLabel({ providerID: model.providerID, id: model.modelID }, models()),
                                      19,
                                    )}
                                    steps={formatCount(model.steps)}
                                    cost={formatCost(model.cost)}
                                    expanded={expanded().has(key)}
                                    text={theme.text.base}
                                    muted={theme.text.muted}
                                    toggle={() => toggle(key)}
                                  />
                                  <Show when={expanded().has(key)}>
                                    <box paddingLeft={2}>
                                      <Row label="Input" value={formatCount(model.tokens.input)} />
                                      <Row label="Output" value={formatCount(model.tokens.output)} />
                                      <Row label="Reasoning" value={formatCount(model.tokens.reasoning)} />
                                      <Row label="Cache read" value={formatCount(model.tokens.cache.read)} />
                                      <Row label="Cache write" value={formatCount(model.tokens.cache.write)} />
                                      <Row label="Cache rate" value={formatCacheRate(cacheRate(model.tokens))} />
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
            <Header open={benchOpen()} toggle={() => setBenchOpen((open) => !open)} title="Terminal Bench 2.0" />
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

async function messages(context: Plugin.Context, sessionID: string, cursor?: string): Promise<SessionMessageInfo[]> {
  const page = await context.client.message.list({ sessionID, limit: 200, cursor })
  if (!page.cursor.next) return [...page.data]
  return [...page.data, ...(await messages(context, sessionID, page.cursor.next))]
}

export default Plugin.define({
  id: "kilocode.sidebar.usage",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      order: 150,
      render: (props) => <SidebarUsage context={context} sessionID={props.sessionID} />,
    })
  },
})
