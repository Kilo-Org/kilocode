import { For, Show, createMemo } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { Select } from "@kilocode/kilo-ui/select"
import { Tag } from "@kilocode/kilo-ui/tag"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../context/language"
import { useStack } from "../../context/stack"
import { resourceMethod, resourceMethods, resourceValue, resourcesForTechnology } from "../../context/stack-state"
import type { StackMcpMethod, StackParameter, StackParameterValue, StackResourceChoice } from "../../types/stack"
import { fieldID } from "./resource-id"

interface ParameterOption {
  key: string
  label: string
  value: StackParameterValue
}

function ParameterField(props: { technology: string; choice: StackResourceChoice; parameter: StackParameter }) {
  const stack = useStack()
  const language = useLanguage()
  const value = () => resourceValue(stack.draft(), props.choice, props.parameter)
  const issue = () =>
    stack
      .issues()
      .find(
        (candidate) =>
          candidate.code === "parameter_required" &&
          candidate.resource === props.choice.resource.ref &&
          candidate.parameter === props.parameter.id,
      )
  const error = () => {
    const current = issue()
    if (!current) return
    return language.t("stack.validation.parameterRequired", {
      parameter: current.parameterLabel ?? props.parameter.name,
      resource: current.resourceName,
    })
  }
  const options = createMemo<ParameterOption[]>(() =>
    (props.parameter.allowed_values ?? []).map((item) => ({
      key: `${typeof item}:${String(item)}`,
      label: String(item),
      value: item,
    })),
  )
  const current = () => options().find((option) => option.value === value())
  const id = () => fieldID(props.technology, props.choice.resource.ref, `parameter-${props.parameter.id}`)

  return (
    <Show
      when={!props.parameter.sensitive}
      fallback={
        <div class="stack-secret-reference">
          <div>
            <strong>
              {props.parameter.name}
              <Show when={props.parameter.required}> *</Show>
            </strong>
            <p>{language.t("stack.resource.secretDescription")}</p>
          </div>
          <Show when={props.parameter.environment}>{(environment) => <Tag>{`{env:${environment()}}`}</Tag>}</Show>
        </div>
      }
    >
      <Show
        when={props.parameter.type !== "boolean"}
        fallback={
          <Checkbox
            id={id()}
            checked={value() === true}
            onChange={(checked) => stack.setResourceParameter(props.choice, props.parameter, checked)}
            description={props.parameter.description}
            disabled={!stack.editable() || props.choice.availability !== "available"}
          >
            {props.parameter.name}
          </Checkbox>
        }
      >
        <Show
          when={options().length === 0}
          fallback={
            <div class="stack-select-field">
              <span class="stack-field-label" id={`${id()}-label`}>
                {props.parameter.name}
                <Show when={props.parameter.required}> *</Show>
              </span>
              <Select
                options={options()}
                current={current()}
                value={(option) => option.key}
                label={(option) => option.label}
                placeholder={language.t("stack.resource.parameterPlaceholder")}
                onSelect={(option) => stack.setResourceParameter(props.choice, props.parameter, option?.value)}
                disabled={!stack.editable() || props.choice.availability !== "available"}
                triggerProps={{
                  id: id(),
                  "aria-labelledby": `${id()}-label`,
                  "aria-describedby": error() ? `${id()}-error` : undefined,
                  "aria-invalid": !!error(),
                }}
              />
              <Show when={props.parameter.description}>
                {(description) => <p class="stack-field-hint">{description()}</p>}
              </Show>
              <Show when={error()}>
                {(message) => (
                  <p class="stack-field-error" id={`${id()}-error`} role="alert">
                    {message()}
                  </p>
                )}
              </Show>
            </div>
          }
        >
          <TextField
            id={id()}
            type={props.parameter.type === "integer" ? "number" : props.parameter.type === "url" ? "url" : "text"}
            step={props.parameter.type === "integer" ? "1" : undefined}
            label={props.parameter.name}
            description={props.parameter.description}
            required={props.parameter.required}
            disabled={!stack.editable() || props.choice.availability !== "available"}
            value={value() === undefined ? "" : String(value())}
            validationState={error() ? "invalid" : "valid"}
            error={error()}
            onChange={(raw) => {
              const next = props.parameter.type === "integer" ? (raw === "" ? undefined : Number(raw)) : raw
              stack.setResourceParameter(props.choice, props.parameter, next)
            }}
          />
        </Show>
      </Show>
    </Show>
  )
}

function MethodField(props: { technology: string; choice: StackResourceChoice }) {
  const stack = useStack()
  const language = useLanguage()
  const methods = () => resourceMethods(props.choice)
  const current = () => resourceMethod(stack.draft(), props.choice)
  const issue = () =>
    stack
      .issues()
      .find((candidate) => candidate.code === "method_required" && candidate.resource === props.choice.resource.ref)
  const id = () => fieldID(props.technology, props.choice.resource.ref, "method")

  return (
    <div class="stack-select-field">
      <span class="stack-field-label" id={`${id()}-label`}>
        {language.t("stack.resource.method")} *
      </span>
      <Select
        options={methods()}
        current={current()}
        value={(method) => method.id}
        label={(method) =>
          `${method.name} - ${language.t(
            method.template.type === "local" ? "stack.resource.methodLocal" : "stack.resource.methodRemote",
          )}`
        }
        placeholder={language.t("stack.resource.methodPlaceholder")}
        onSelect={(method) => method && stack.setResourceMethod(props.choice, method)}
        disabled={!stack.editable() || props.choice.availability !== "available" || methods().length === 0}
        triggerProps={{
          id: id(),
          "aria-labelledby": `${id()}-label`,
          "aria-describedby": issue() ? `${id()}-error` : `${id()}-hint`,
          "aria-invalid": !!issue(),
        }}
      />
      <p class="stack-field-hint" id={`${id()}-hint`}>
        {language.t("stack.resource.methodDescription")}
      </p>
      <Show when={issue()}>
        <p class="stack-field-error" id={`${id()}-error`} role="alert">
          {language.t("stack.validation.methodRequired", { resource: props.choice.resource.name })}
        </p>
      </Show>
    </div>
  )
}

function MethodNotices(props: { method: StackMcpMethod }) {
  const language = useLanguage()
  const environments = createMemo(() => [
    ...new Set([
      ...props.method.parameters.flatMap((parameter) =>
        parameter.sensitive && parameter.environment ? [parameter.environment] : [],
      ),
      ...(props.method.auth.environment ?? []),
    ]),
  ])
  const platforms = () =>
    props.method.platforms.map((platform) => language.t(`stack.resource.platform.${platform}`)).join(", ")

  return (
    <div class="stack-method-notices">
      <Show when={environments().length > 0}>
        <div class="stack-environment-list">
          <span class="stack-field-label">{language.t("stack.resource.sensitivePrerequisites")}</span>
          <div class="stack-resource-tags">
            <For each={environments()}>{(environment) => <Tag>{`{env:${environment}}`}</Tag>}</For>
          </div>
        </div>
      </Show>
      <Show when={props.method.auth.mode === "environment"}>
        <p class="stack-auth-line">{language.t("stack.resource.authEnvironment")}</p>
      </Show>
      <Show when={props.method.auth.mode === "oauth"}>
        <p class="stack-auth-line">{language.t("stack.resource.authOauth")}</p>
      </Show>
      <For each={props.method.prerequisites}>
        {(prerequisite) => <p class="stack-auth-line">{language.t("stack.resource.prerequisite", { prerequisite })}</p>}
      </For>
      <Show when={props.method.warnings.writes}>
        <p class="stack-warning-line">{props.method.warnings.text ?? language.t("stack.resource.writeWarning")}</p>
      </Show>
      <p class={props.method.platforms.length < 3 ? "stack-warning-line" : "stack-auth-line"}>
        {language.t("stack.resource.platforms", { platforms: platforms() })}
      </p>
    </div>
  )
}

function ResourceCard(props: { technology: string; choice: StackResourceChoice }) {
  const stack = useStack()
  const language = useLanguage()
  const enabled = () => stack.resourceEnabled(props.choice)
  const available = () => props.choice.availability === "available"
  const method = () => resourceMethod(stack.draft(), props.choice)
  const warnings = () => [...new Set([...props.choice.resource.warnings, ...props.choice.association.warnings])]

  return (
    <Card class="stack-resource-card" data-active={enabled() || undefined}>
      <div class="stack-resource-header">
        <Checkbox
          id={fieldID(props.technology, props.choice.resource.ref, "enabled")}
          checked={enabled()}
          onChange={(checked) => stack.setResourceEnabled(props.choice, checked)}
          description={props.choice.association.rationale}
          disabled={!stack.editable() || (!available() && !enabled())}
        >
          {props.choice.resource.name}
        </Checkbox>
        <div class="stack-resource-tags">
          <Tag>
            {language.t(props.choice.resource.kind === "skill" ? "stack.resource.skill" : "stack.resource.mcp")}
          </Tag>
          <Tag>{language.t(available() ? "stack.resource.available" : "stack.resource.unavailable")}</Tag>
          <Show when={props.choice.association.default}>
            <Tag>{language.t("stack.resource.recommended")}</Tag>
          </Show>
          <Tag>{props.choice.association.trust}</Tag>
          <Tag>{props.choice.association.maturity}</Tag>
        </div>
      </div>
      <CardDescription>{props.choice.association.rationale}</CardDescription>
      <Show when={props.choice.reason}>{(reason) => <p class="stack-warning-line">{reason()}</p>}</Show>
      <Show when={enabled() && props.choice.resource.kind === "mcp"}>
        <div class="stack-resource-config">
          <MethodField technology={props.technology} choice={props.choice} />
          <Show when={method()}>
            {(selected) => (
              <>
                <For each={selected().parameters}>
                  {(parameter) => (
                    <ParameterField technology={props.technology} choice={props.choice} parameter={parameter} />
                  )}
                </For>
                <MethodNotices method={selected()} />
              </>
            )}
          </Show>
          <p class="stack-auth-line">{language.t("stack.resource.mcpFollowUp")}</p>
        </div>
      </Show>
      <For each={warnings()}>{(warning) => <p class="stack-warning-line">{warning}</p>}</For>
      <Button
        class="stack-source-link"
        variant="ghost"
        size="small"
        icon="open-file"
        onClick={() => stack.openExternal(props.choice.association.source)}
        disabled={!stack.editable()}
      >
        {language.t("stack.resource.source")}
      </Button>
    </Card>
  )
}

export function ResourceStep() {
  const stack = useStack()
  const language = useLanguage()
  const catalog = () => stack.data()?.catalog
  const technologies = createMemo(() => {
    const source = catalog()?.catalog
    if (!source) return []
    return stack
      .selected()
      .map((id) => source.verticals.flatMap((vertical) => vertical.technologies).find((item) => item.id === id))
      .filter((technology) => !!technology)
  })

  return (
    <section class="stack-step" aria-labelledby="stack-resources-title">
      <div class="stack-step-heading">
        <span class="stack-kicker">{language.t("stack.resources.kicker")}</span>
        <h2 id="stack-resources-title" tabIndex={-1}>
          {language.t("stack.resources.title")}
        </h2>
        <p>{language.t("stack.resources.description")}</p>
      </div>
      <Show when={stack.issues().length > 0}>
        <Card variant="error" class="stack-inline-error" role="alert">
          <CardTitle variant="error">{language.t("stack.validation.title")}</CardTitle>
          <CardDescription>{language.t("stack.validation.description")}</CardDescription>
          <For each={stack.issues()}>
            {(issue) => (
              <p class="stack-field-error">
                {issue.code === "method_required"
                  ? language.t("stack.validation.methodRequired", { resource: issue.resourceName })
                  : language.t("stack.validation.parameterRequired", {
                      parameter: issue.parameterLabel ?? issue.parameter ?? "",
                      resource: issue.resourceName,
                    })}
              </p>
            )}
          </For>
        </Card>
      </Show>
      <Show
        when={technologies().length > 0}
        fallback={
          <Card class="stack-inline-empty">
            <CardTitle icon="help">{language.t("stack.resources.emptyTitle")}</CardTitle>
            <CardDescription>{language.t("stack.resources.emptyDescription")}</CardDescription>
          </Card>
        }
      >
        <For each={technologies()}>
          {(technology) => {
            const resources = () => (catalog() ? resourcesForTechnology(catalog()!, technology.id) : [])
            return (
              <section class="stack-resource-group" aria-labelledby={`stack-technology-${technology.id}`}>
                <div class="stack-resource-group-title">
                  <h3 id={`stack-technology-${technology.id}`}>{technology.name}</h3>
                  <Tag>{language.t("stack.resources.candidateCount", { count: resources().length })}</Tag>
                </div>
                <Show
                  when={resources().length > 0}
                  fallback={<p class="stack-muted">{language.t("stack.resources.noCandidates")}</p>}
                >
                  <For each={["skill", "mcp"] as const}>
                    {(kind) => (
                      <Show when={resources().some((choice) => choice.resource.kind === kind)}>
                        <h4>{language.t(kind === "skill" ? "stack.resource.skills" : "stack.resource.mcps")}</h4>
                        <div class="stack-resource-list">
                          <For each={resources().filter((choice) => choice.resource.kind === kind)}>
                            {(choice) => <ResourceCard technology={technology.id} choice={choice} />}
                          </For>
                        </div>
                      </Show>
                    )}
                  </For>
                </Show>
              </section>
            )
          }}
        </For>
      </Show>
    </section>
  )
}
