import { createClient, type KiloGatewayAccount } from "@kilocode/client"
import type { ModelInfo } from "@opencode-ai/client"
import { KiloModels, type Entry } from "@opencode-ai/schema/kilocode/models"
import { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, on } from "solid-js"
import type { Accessor } from "solid-js"
import { currentSessionModel } from "./sidebar-bench"

export type ModelInfoDialogOptions = {
  readonly client?: Pick<ReturnType<typeof createClient>, "rpc">
  readonly account?: Accessor<KiloGatewayAccount | undefined>
  /** Increments for every profile refresh; a change invalidates an open dialog. */
  readonly revision?: Accessor<number>
  readonly signal?: AbortSignal
}

/**
 * Relocated model-info capability (Kilo-owned): a standalone browse-only
 * "Kilo model info" command. Not the v1 picker-attached preview panel — that
 * native layout has no public seam in v2 and stays pending. Fields are bounded
 * to the public generated ModelInfo records and the accepted KiloModels Entry
 * bench data; nothing here mutates the session model.
 */
export function installModelInfoDialog(ctx: Plugin.Context, options: ModelInfoDialogOptions = {}) {
  const rpc = options.client?.rpc(KiloModels.Definition)
  ctx.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "kilo.model-info",
        title: "Kilo model info",
        group: "Kilo",
        palette: true,
        slash: { name: "model-info" },
        run: async () => {
          await showModelInfoDialog(ctx, {
            rpc,
            signal: options.signal,
            account: options.account,
            revision: options.revision,
          })
        },
      },
    ],
  }))
}

// Units pinned from v1 kilocode/components/model-info-panel-utils.ts:10-48
// (reimplemented locally; source-tree imports are not allowed here).
export function fmtPrice(n: number): string {
  if (n < 0) return "—"
  if (n === 0) return "Free"
  if (n < 0.01) return `$${n.toFixed(4)}/1M`
  return `$${n.toFixed(2)}/1M`
}

// V1 rule (model-info-panel-utils.ts:28): cache.read > 0 or input === 0.
export function fmtCachedPrice(cost: { readonly input: number; readonly cache: { readonly read: number } }): string | null {
  if (cost.cache.read > 0) return fmtPrice(cost.cache.read)
  if (cost.input === 0) return fmtPrice(0)
  return null
}

export function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return String(n)
}

function fmtReleased(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ""
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short" })
}

type DialogScope = {
  readonly rpc?: ReturnType<NonNullable<ModelInfoDialogOptions["client"]>["rpc"]>
  readonly signal?: AbortSignal
  readonly account?: Accessor<KiloGatewayAccount | undefined>
  readonly revision?: Accessor<number>
}

async function showModelInfoDialog(ctx: Plugin.Context, options: DialogScope) {
  // ctx.location is a reactive getter (host.location.current): the eligibility
  // identity snapshots it before the first await and unchanged() rereads the
  // live value, so a location change during the awaits invalidates the open.
  const liveLocation = () => ctx.location ?? ctx.data.location.default()
  const identity = () =>
    [
      options.revision?.() ?? 0,
      options.account?.()?.currentOrganizationID ?? "personal",
      options.account?.()?.selectionAvailable ?? false,
      liveLocation()?.directory ?? "",
      liveLocation()?.workspaceID ?? "",
    ].join("\u0000")
  const eligibility = identity()
  const location = liveLocation()
  const unchanged = () => identity() === eligibility
  // The data store syncs the location model list lazily; an explicit sync makes
  // the browse list deterministic at command time.
  try {
    await ctx.data.location.model.sync(location)
  } catch {
    if (!options.signal?.aborted && unchanged())
      ctx.ui.toast.show({ title: "Kilo model info", message: "Unable to load models. Try again.", variant: "error" })
    return
  }
  if (options.signal?.aborted || !unchanged()) return
  const models = (ctx.data.location.model.list(location) ?? []).filter((model) => model.enabled)
  if (models.length === 0) {
    ctx.ui.toast.show({ title: "Kilo model info", message: "No models available for this location.", variant: "info" })
    return
  }
  const route = ctx.ui.router.current()
  const sessionID = route.type === "session" ? route.sessionID : undefined
  const current = sessionID ? currentSessionModel(ctx.data, sessionID) : undefined
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
  // Fresh per open: the bench lookup must not reuse a previous dialog's catalog.
  let metadata: readonly Entry[] | undefined
  let metadataAvailable = true
  if (options.rpc) {
    try {
      metadata = await options.rpc.list({}, { location, signal })
    } catch {
      if (signal.aborted) return
      metadata = undefined
      metadataAvailable = false
    }
  } else {
    metadataAvailable = false
  }
  if (signal.aborted || !unchanged()) return
  const selected = await ctx.ui.dialog.select<{ providerID: string; id: string }>({
    title: "Kilo model info",
    options: models.map((model) => ({ title: model.name, value: { providerID: model.providerID, id: model.id } })),
    current: current ? { providerID: current.providerID, id: current.id } : undefined,
  })
  if (!selected || signal.aborted || !unchanged()) return
  const model = models.find((item) => item.providerID === selected.providerID && item.id === selected.id)
  if (!model) return
  ctx.ui.dialog.set({ size: "large" })
  ctx.ui.dialog.show(
    () => (
      <ModelInfoDialog
        context={ctx}
        model={model}
        metadata={metadata}
        metadataAvailable={metadataAvailable}
        account={options.account}
        revision={options.revision}
      />
    ),
    () => controller.abort(),
  )
}

function ModelInfoDialog(props: {
  readonly context: Plugin.Context
  readonly model: ModelInfo
  readonly metadata: readonly Entry[] | undefined
  readonly metadataAvailable: boolean
  readonly account?: Accessor<KiloGatewayAccount | undefined>
  readonly revision?: Accessor<number>
}) {
  const theme = props.context.theme.text
  const dimensions = useTerminalDimensions()
  const height = createMemo(() => Math.max(8, Math.min(30, Math.floor(dimensions().height * 0.8) - 4)))

  // Bounded cost rule: exactly one untiered quote is the labeled base quote;
  // tiered entries are rendered with their source threshold (context > tier.size);
  // an empty cost array is "Pricing unavailable"; multiple untiered quotes are
  // treated as unavailable. No invented average costs.
  const pricing = createMemo(() => {
    const untiered = props.model.cost.filter((cost) => cost.tier === undefined)
    const tiered = props.model.cost.filter((cost) => cost.tier !== undefined)
    if (untiered.length === 1) return { base: untiered[0], tiered: tiered.length > 0 }
    if (tiered.length > 0) return { base: undefined, tiered: true }
    return { base: undefined, tiered: false, unavailable: true }
  })

  const tieredCosts = createMemo(() => {
    return props.model.cost
      .filter((cost) => cost.tier?.type === "context")
      .toSorted((a, b) => (a.tier?.size ?? 0) - (b.tier?.size ?? 0))
  })

  const released = createMemo(() => fmtReleased(props.model.time.released))

  // Display-only metadata is Kilo-scope only: never match another provider's model id.
  const metadata = createMemo(() => {
    if (props.model.providerID !== "kilo") return undefined
    return props.metadata?.find((entry) => entry.id === props.model.id)
  })
  const bench = createMemo(() => metadata()?.terminalBench)
  const family = createMemo(() => props.model.family ?? metadata()?.family)
  const description = createMemo(() => metadata()?.description)
  const reasoning = createMemo(() => metadata()?.reasoning)

  // A scope/account change while the dialog is open invalidates the eligibility
  // snapshot; close rather than retain stale data. defer keeps this off the
  // initial mount, and the effect must not own global dialog cleanup — it only
  // reacts to scope changes this panel observed.
  createEffect(
    on(
      () => [
        props.revision?.(),
        props.account?.()?.currentOrganizationID,
        props.account?.()?.selectionAvailable,
        props.context.location?.directory,
        props.context.location?.workspaceID,
      ],
      () => props.context.ui.dialog.clear(),
      { defer: true },
    ),
  )

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <scrollbox
        maxHeight={height()}
        verticalScrollbarOptions={{ visible: true }}
        viewportOptions={{ paddingRight: 1 }}
      >
        <box flexDirection="row" gap={1}>
          <text fg={theme.default}>
            <b>{props.model.name}</b>
          </text>
          <text fg={theme.subdued}>{props.model.providerID}</text>
        </box>
          <Show when={family()}>
            {(fam) => (
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.subdued}>Family</text>
                <text fg={theme.default}>{fam().charAt(0).toUpperCase() + fam().slice(1)}</text>
              </box>
            )}
          </Show>
          <Show when={description()}>
            {(desc) => (
              <box flexDirection="column">
                <text fg={theme.subdued}>Description</text>
                <text fg={theme.default}>{desc()}</text>
              </box>
            )}
          </Show>
          <Show when={released()}>
            {(value) => (
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.subdued}>Released</text>
                <text fg={theme.default}>{value()}</text>
              </box>
            )}
          </Show>
          <Show when={pricing().base}>
            {(base) => (
              <box>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.subdued}>Input</text>
                  <text fg={theme.default}>{fmtPrice(base().input)}</text>
                </box>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.subdued}>Output</text>
                  <text fg={theme.default}>{fmtPrice(base().output)}</text>
                </box>
                <Show when={fmtCachedPrice(base())}>
                  {(cached) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.subdued}>Cached</text>
                      <text fg={theme.default}>{cached()}</text>
                    </box>
                  )}
                </Show>
              </box>
            )}
          </Show>
          <Show when={tieredCosts().length > 0}>
            <box gap={1}>
              <For each={tieredCosts()}>
                {(tier) => (
                  <box>
                    <text fg={theme.subdued}>{`Context > ${fmtContext(tier.tier!.size)}:`}</text>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.subdued}>  Input</text>
                      <text fg={theme.default}>{fmtPrice(tier.input)}</text>
                    </box>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.subdued}>  Output</text>
                      <text fg={theme.default}>{fmtPrice(tier.output)}</text>
                    </box>
                    <Show when={fmtCachedPrice(tier)}>
                      {(cached) => (
                        <box flexDirection="row" justifyContent="space-between">
                          <text fg={theme.subdued}>  Cached</text>
                          <text fg={theme.default}>{cached()}</text>
                        </box>
                      )}
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </Show>
          <Show when={!pricing().base && tieredCosts().length === 0}>
            <text fg={theme.subdued}>{pricing().unavailable ? "Pricing unavailable" : "Tiered pricing available"}</text>
          </Show>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.subdued}>Context</text>
            <text fg={theme.default}>{fmtContext(props.model.limit.context)}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.subdued}>Max output</text>
            <text fg={theme.default}>{fmtContext(props.model.limit.output)}</text>
          </box>
          <text fg={theme.subdued}>Input types: {props.model.capabilities.input.join(", ")}</text>
          <text fg={theme.subdued}>Output types: {props.model.capabilities.output.join(", ")}</text>
          <text fg={theme.subdued}>Tool calling: {props.model.capabilities.tools ? "Yes" : "No"}</text>
          <Show when={reasoning()}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.subdued}>Reasoning</text>
              <text fg={theme.default}>Yes</text>
            </box>
          </Show>
          <Show when={metadata()?.hasUserByokAvailable === true}>
            <text fg={theme.subdued}>Your API key is available for this model (BYOK).</text>
          </Show>
          <Show when={metadata()?.mayTrainOnYourPrompts === true}>
            <text fg={theme.feedback.warning.default}>This model may train on your prompts.</text>
          </Show>
          <Show when={props.metadataAvailable === false}>
            <text fg={theme.feedback.warning.default}>Kilo model metadata unavailable for this account scope</text>
          </Show>
          <Show when={bench()}>
            {(value) => (
              <box>
                <text fg={theme.default}>
                  <b>Terminal Bench 2.0</b>
                </text>
                <For
                  each={[
                    ["Completion", `${(value().overallScore * 100).toFixed(1)}%`],
                    ["Cost / attempt", `$${value().avgAttemptCostUsd.toFixed(2)}`],
                  ]}
                >
                  {(row) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.subdued}>{row[0]}</text>
                      <text fg={theme.subdued}>{row[1]}</text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </Show>
      </scrollbox>
      <text fg={theme.subdued}>Browse only; the session model is unchanged.</text>
    </box>
  )
}
