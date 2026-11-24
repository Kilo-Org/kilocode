import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createSignal, For, Show } from "solid-js"
import { useLanguage } from "../context/language"
import { formatEstimatedCost, type AutoModelPreviewController } from "./auto-model-preview-state"

type Language = ReturnType<typeof useLanguage>

function profileLabel(language: Language, profile: KiloGatewayRpc.AutoModelProfile): string {
  return language.t(profile === "frontier" ? "autoModel.preview.profile.frontier" : "autoModel.preview.profile.efficient")
}

function fitLabel(language: Language, fit: KiloGatewayRpc.AutoModelTaskFit): string {
  if (fit === "very_high") return language.t("autoModel.preview.fit.veryHigh")
  if (fit === "high") return language.t("autoModel.preview.fit.high")
  if (fit === "medium") return language.t("autoModel.preview.fit.medium")
  return language.t("autoModel.preview.fit.low")
}

function riskText(language: Language, risk: KiloGatewayRpc.AutoModelPreviewRisk | null): string {
  if (!risk) return language.t("autoModel.preview.notAvailable")
  const level =
    risk.level === "high"
      ? language.t("autoModel.preview.risk.high")
      : risk.level === "medium"
        ? language.t("autoModel.preview.risk.medium")
        : language.t("autoModel.preview.risk.low")
  return risk.detail ? `${level} · ${risk.detail}` : level
}

function toolsText(language: Language, value: boolean | null): string {
  if (value === null) return language.t("autoModel.preview.notAvailable")
  return language.t(value ? "autoModel.preview.yes" : "autoModel.preview.no")
}

function textOrUnavailable(language: Language, value: string | null): string {
  return value && value.trim() ? value : language.t("autoModel.preview.notAvailable")
}

export function AutoModelPreviewButton(props: { controller: AutoModelPreviewController }) {
  const language = useLanguage()
  return (
    <Tooltip value={language.t("autoModel.preview.buttonTooltip")} placement="top">
      <button
        type="button"
        class="auto-model-preview-trigger"
        classList={{ "auto-model-preview-trigger--active": props.controller.open() }}
        disabled={!props.controller.enabled()}
        aria-expanded={props.controller.open()}
        aria-controls="auto-model-preview-panel"
        data-action="auto-model-preview"
        onClick={() => props.controller.toggle()}
      >
        <Icon name="sparkle" size="small" />
        <span class="auto-model-preview-trigger-label">{language.t("autoModel.preview.button")}</span>
      </button>
    </Tooltip>
  )
}

function AttributesSection(props: {
  attributes: KiloGatewayRpc.AutoModelPreviewAttributes
  defaultOpen?: boolean
}) {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(props.defaultOpen ?? true)
  const risk = () => props.attributes.risk

  return (
    <div class="auto-model-preview-box auto-model-preview-attrs">
      <button
        type="button"
        class="auto-model-preview-attrs-toggle"
        aria-expanded={expanded()}
        data-action="auto-model-preview-attributes"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Icon name="chevron-down" size="small" class="auto-model-preview-chevron" />
        <span>{language.t("autoModel.preview.additionalAttributes")}</span>
      </button>
      <Show when={expanded()}>
        <dl class="auto-model-preview-attrs-list">
          <div class="auto-model-preview-attr-row">
            <dt>{language.t("autoModel.preview.attribute.contextComplexity")}</dt>
            <dd data-missing={props.attributes.contextComplexity === null ? "true" : undefined}>
              {textOrUnavailable(language, props.attributes.contextComplexity)}
            </dd>
          </div>
          <div class="auto-model-preview-attr-row">
            <dt>{language.t("autoModel.preview.attribute.reasoningComplexity")}</dt>
            <dd data-missing={props.attributes.reasoningComplexity === null ? "true" : undefined}>
              {textOrUnavailable(language, props.attributes.reasoningComplexity)}
            </dd>
          </div>
          <div class="auto-model-preview-attr-row">
            <dt>{language.t("autoModel.preview.attribute.risk")}</dt>
            <dd data-risk={risk()?.level} data-missing={risk() === null ? "true" : undefined}>
              {riskText(language, risk())}
            </dd>
          </div>
          <div class="auto-model-preview-attr-row">
            <dt>{language.t("autoModel.preview.attribute.executionMode")}</dt>
            <dd data-missing={props.attributes.executionMode === null ? "true" : undefined}>
              {textOrUnavailable(language, props.attributes.executionMode)}
            </dd>
          </div>
          <div class="auto-model-preview-attr-row">
            <dt>{language.t("autoModel.preview.attribute.toolsRequired")}</dt>
            <dd data-missing={props.attributes.toolsRequired === null ? "true" : undefined}>
              {toolsText(language, props.attributes.toolsRequired)}
            </dd>
          </div>
        </dl>
      </Show>
    </div>
  )
}

function CandidatesTable(props: { candidates: readonly KiloGatewayRpc.AutoModelPreviewCandidate[] }) {
  const language = useLanguage()
  const unavailable = () => language.t("autoModel.preview.notAvailable")
  return (
    <table class="auto-model-preview-table">
      <thead>
        <tr>
          <th scope="col">{language.t("autoModel.preview.table.candidate")}</th>
          <th scope="col" class="auto-model-preview-col-num">
            {language.t("autoModel.preview.table.estCost")}
          </th>
          <th scope="col" class="auto-model-preview-col-fit">
            {language.t("autoModel.preview.table.taskFit")}
          </th>
        </tr>
      </thead>
      <tbody>
        <For each={props.candidates}>
          {(candidate) => (
            <tr data-predicted={candidate.predicted ? "true" : undefined} data-current={candidate.current ? "true" : undefined}>
              <td class="auto-model-preview-candidate-name">
                <span>{candidate.modelName}</span>
                <Show when={candidate.current}>
                  <span class="auto-model-preview-badge auto-model-preview-badge--current">
                    {language.t("autoModel.preview.badge.current")}
                  </span>
                </Show>
              </td>
              <td class="auto-model-preview-col-num">
                {formatEstimatedCost(candidate.estimatedCostUsd, unavailable())}
              </td>
              <td class="auto-model-preview-col-fit">{fitLabel(language, candidate.taskFit)}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  )
}

export function AutoModelPreviewCard(props: {
  result?: KiloGatewayRpc.AutoModelPreviewResult
  loading?: boolean
  error?: string
  stale?: boolean
  defaultAttributesOpen?: boolean
  onClose: () => void
  onRetry?: () => void
}) {
  const language = useLanguage()

  return (
    <section
      id="auto-model-preview-panel"
      class="auto-model-preview"
      data-component="auto-model-preview"
      role="region"
      aria-label={language.t("autoModel.preview.title")}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        e.stopPropagation()
        props.onClose()
      }}
    >
      <div class="auto-model-preview-header">
        <span class="auto-model-preview-title">{language.t("autoModel.preview.title")}</span>
        <IconButton
          icon="close-small"
          size="small"
          variant="ghost"
          aria-label={language.t("autoModel.preview.close")}
          data-action="auto-model-preview-close"
          onClick={() => props.onClose()}
        />
      </div>

      <div class="auto-model-preview-body">
        <Show when={props.loading}>
          <div class="auto-model-preview-status" role="status">
            <span class="auto-model-preview-spinner" aria-hidden="true" />
            <span>{language.t("autoModel.preview.loading")}</span>
          </div>
        </Show>

        <Show when={!props.loading && props.error}>
          <div class="auto-model-preview-error" role="alert">
            <span>{language.t("autoModel.preview.error")}</span>
            <Show when={props.onRetry}>
              {(retry) => (
                <Button size="small" variant="secondary" onClick={() => retry()()}>
                  {language.t("autoModel.preview.retry")}
                </Button>
              )}
            </Show>
          </div>
        </Show>

        <Show when={!props.loading && !props.error && props.result}>
          {(data) => (
            <>
              <Show when={props.stale}>
                <div class="auto-model-preview-stale" role="status">
                  {language.t("autoModel.preview.stale")}
                </div>
              </Show>

              <div class="auto-model-preview-box auto-model-preview-task">
                <div class="auto-model-preview-micro">{language.t("autoModel.preview.taskCategory")}</div>
                <div class="auto-model-preview-task-title">{data().task.category}</div>
                <div class="auto-model-preview-task-summary">{data().task.summary}</div>
              </div>

              <AttributesSection attributes={data().attributes} defaultOpen={props.defaultAttributesOpen} />

              <div class="auto-model-preview-selection">
                <div class="auto-model-preview-micro">
                  {language.t("autoModel.preview.predictedSelection", {
                    profile: profileLabel(language, data().profile),
                  })}
                </div>
                <div class="auto-model-preview-selection-row">
                  <span class="auto-model-preview-selection-name">{data().selection.modelName}</span>
                  <span class="auto-model-preview-badge auto-model-preview-badge--predicted">
                    {language.t("autoModel.preview.badge.predicted")}
                  </span>
                </div>
                <p class="auto-model-preview-rationale">{data().selection.rationale}</p>
              </div>

              <CandidatesTable candidates={data().candidates} />

              <Show when={data().recommendation}>
                {(recommendation) => (
                  <div class="auto-model-preview-callout">
                    <strong>
                      {language.t("autoModel.preview.consider", {
                        profile: profileLabel(language, recommendation().suggestedProfile),
                      })}
                    </strong>{" "}
                    <span>{recommendation().reason}</span>
                  </div>
                )}
              </Show>

              <p class="auto-model-preview-disclaimer">
                {language.t(
                  data().illustrative
                    ? "autoModel.preview.disclaimer.illustrative"
                    : "autoModel.preview.disclaimer.live",
                )}
              </p>
            </>
          )}
        </Show>
      </div>
    </section>
  )
}

export function AutoModelPreviewDock(props: { controller: AutoModelPreviewController }) {
  return (
    <Show when={props.controller.open()}>
      <AutoModelPreviewCard
        result={props.controller.result()}
        loading={props.controller.loading()}
        error={props.controller.error()}
        stale={props.controller.stale()}
        onClose={props.controller.close}
        onRetry={props.controller.refresh}
      />
    </Show>
  )
}
