import { For, Show } from "solid-js"
import { Card } from "@kilocode/kilo-web-ui/card"
import { Checkbox } from "@kilocode/kilo-web-ui/checkbox"
import { ConfigTag } from "../ConfigPage"
import {
  stackParameterValue,
  stackResourceEnabled,
  stackResourceMethod,
  stackResourceMethods,
  stackResourceParameters,
  stackSelectedMethod,
  type StackWizard,
} from "../state/stack"
import type { StackMethod, StackParameter, StackParameterValue, StackResourceItem } from "./types"

function inputValue(value: StackParameterValue | undefined) {
  if (value === undefined) return ""
  return String(value)
}

function platforms(method: StackMethod) {
  const names = { darwin: "macOS", linux: "Linux", win32: "Windows" }
  return method.platforms.map((platform) => names[platform]).join(", ")
}

function authentication(method: StackMethod) {
  if (method.auth.mode === "none") return "None"
  if (method.auth.mode === "oauth") return "OAuth after installation"
  const names = method.auth.environment?.join(", ")
  return names ? `Environment variables: ${names}` : "Environment variables"
}

function option(value: StackParameterValue) {
  return `${typeof value}:${String(value)}`
}

function optionValue(value: StackParameterValue | undefined) {
  return value === undefined ? "" : option(value)
}

function ParameterField(props: { state: StackWizard; item: StackResourceItem; parameter: StackParameter }) {
  const value = () => stackParameterValue(props.state.draft(), props.item, props.parameter)
  const issue = () =>
    props.state
      .issues()
      .find((item) => item.resource === props.item.resource.ref && item.parameter === props.parameter.id)
  const disabled = () => props.item.availability !== "available" || props.state.busy() === "apply"

  if (props.parameter.sensitive) {
    return (
      <div class="stack-secret-field">
        <span>
          {props.parameter.label}
          <Show when={props.parameter.required}> *</Show>
        </span>
        <code>{props.parameter.env ? `{env:${props.parameter.env}}` : "Environment reference unavailable"}</code>
        <small>Secret values are never collected by this wizard.</small>
      </div>
    )
  }

  if (props.parameter.values?.length) {
    return (
      <label class="stack-parameter" classList={{ invalid: Boolean(issue()) }}>
        <span>
          {props.parameter.label}
          <Show when={props.parameter.required}> *</Show>
        </span>
        <select
          value={optionValue(value())}
          aria-invalid={Boolean(issue())}
          disabled={disabled()}
          onChange={(event) => {
            const selected = props.parameter.values?.find((item) => option(item) === event.currentTarget.value)
            props.state.parameter(props.item, props.parameter, selected)
          }}
        >
          <option value="">Select a value</option>
          <For each={props.parameter.values}>{(item) => <option value={option(item)}>{String(item)}</option>}</For>
        </select>
        <Show when={props.parameter.description}>{(description) => <small>{description()}</small>}</Show>
        <Show when={issue()}>{(item) => <small class="stack-field-error">{item().message}</small>}</Show>
      </label>
    )
  }

  if (props.parameter.type === "boolean") {
    return (
      <Checkbox
        checked={value() === true}
        onChange={(checked) => props.state.parameter(props.item, props.parameter, checked)}
        description={props.parameter.description}
        disabled={disabled()}
      >
        {props.parameter.label}
      </Checkbox>
    )
  }

  const numeric = props.parameter.type === "integer"
  return (
    <label class="stack-parameter" classList={{ invalid: Boolean(issue()) }}>
      <span>
        {props.parameter.label}
        <Show when={props.parameter.required}> *</Show>
      </span>
      <input
        type={numeric ? "number" : props.parameter.type === "url" ? "url" : "text"}
        value={inputValue(value())}
        aria-invalid={Boolean(issue())}
        disabled={disabled()}
        onInput={(event) => {
          const raw = event.currentTarget.value
          const next = numeric ? (raw === "" ? undefined : Number(raw)) : raw
          props.state.parameter(props.item, props.parameter, next)
        }}
      />
      <Show when={props.parameter.description}>{(description) => <small>{description()}</small>}</Show>
      <Show when={issue()}>{(item) => <small class="stack-field-error">{item().message}</small>}</Show>
    </label>
  )
}

function ResourceCard(props: { state: StackWizard; item: StackResourceItem }) {
  const enabled = () => stackResourceEnabled(props.state.draft(), props.item)
  const available = () => props.item.availability === "available"
  const method = () => stackResourceMethod(props.state.draft(), props.item)
  const methods = () => stackResourceMethods(props.item)
  const selected = () => stackSelectedMethod(props.state.draft(), props.item)
  const parameters = () => stackResourceParameters(props.state.draft(), props.item)
  const error = () => props.state.issues().find((item) => item.resource === props.item.resource.ref && !item.parameter)
  const warnings = () => [...new Set([...props.item.resource.warnings, ...props.item.association.warnings])]

  return (
    <Card class="stack-resource-card" classList={{ selected: enabled() }} padding={0}>
      <div class="stack-resource-main">
        <Checkbox
          checked={enabled()}
          onChange={(checked) => props.state.enable(props.item, checked)}
          description={props.item.association.rationale}
          disabled={(!available() && !enabled()) || props.state.busy() === "apply"}
        >
          {props.item.resource.name}
        </Checkbox>
        <div class="stack-resource-tags">
          <ConfigTag tone={props.item.availability === "available" ? "success" : "warning"}>
            {props.item.availability}
          </ConfigTag>
          <ConfigTag tone="neutral">{props.item.association.trust}</ConfigTag>
          <ConfigTag tone="neutral">{props.item.association.maturity}</ConfigTag>
        </div>
      </div>

      <p class="stack-resource-rationale">Recommended because {props.item.association.rationale}</p>
      <Show when={props.item.reason}>{(reason) => <p class="stack-resource-rationale">{reason()}</p>}</Show>

      <Show when={enabled() && props.item.resource.kind === "mcp"}>
        <div class="stack-mcp-config">
          <label classList={{ invalid: Boolean(error()) }}>
            <span>Marketplace installation method *</span>
            <select
              value={method()}
              aria-invalid={Boolean(error())}
              disabled={!available() || !methods().length || props.state.busy() === "apply"}
              onChange={(event) => props.state.method(props.item, event.currentTarget.value)}
            >
              <option value="">Select an installation method</option>
              <Show when={method() && !methods().some((item) => item.id === method())}>
                <option value={method()}>{method()} (details unavailable)</option>
              </Show>
              <For each={methods()}>
                {(item) => (
                  <option value={item.id}>
                    {item.name} ({item.template.type})
                  </option>
                )}
              </For>
            </select>
            <Show
              when={methods().length}
              fallback={<small>Marketplace installation method details are unavailable for this resource.</small>}
            >
              <small>Select a Marketplace method to configure only the parameters it supports.</small>
            </Show>
            <Show when={error()}>{(item) => <small class="stack-field-error">{item().message}</small>}</Show>
          </label>

          <Show when={selected()}>
            {(item) => (
              <div class="stack-method-details">
                <div class="stack-method-meta">
                  <div>
                    <span>Platforms</span>
                    <strong>{platforms(item())}</strong>
                  </div>
                  <div>
                    <span>Authentication</span>
                    <strong>{authentication(item())}</strong>
                  </div>
                </div>
                <Show when={item().prerequisites.length}>
                  <div class="stack-prerequisites">
                    <strong>Prerequisites</strong>
                    <ul>
                      <For each={item().prerequisites}>{(entry) => <li>{entry}</li>}</For>
                    </ul>
                  </div>
                </Show>
                <Show when={item().warnings.writes}>
                  <div class="stack-method-warning">
                    <strong>Write access</strong>
                    <p>{item().warnings.text ?? "This MCP can perform write operations."}</p>
                  </div>
                </Show>
              </div>
            )}
          </Show>

          <Show when={parameters().length}>
            <div class="stack-parameters">
              <For each={parameters()}>
                {(parameter) => <ParameterField state={props.state} item={props.item} parameter={parameter} />}
              </For>
            </div>
          </Show>
          <p class="stack-mcp-note">
            MCP entries are installed disabled. Authenticate and enable them later in MCP settings.
          </p>
        </div>
      </Show>

      <Show when={warnings().length}>
        <ul class="stack-resource-warnings">
          <For each={warnings()}>{(item) => <li>{item}</li>}</For>
        </ul>
      </Show>

      <a class="stack-source" href={props.item.association.source} target="_blank" rel="noreferrer">
        View source
      </a>
    </Card>
  )
}

export function StackResourcesStep(props: { state: StackWizard }) {
  return (
    <section class="stack-step" aria-labelledby="stack-resources-title">
      <div class="stack-step-heading">
        <p class="eyebrow">Resource setup</p>
        <h2 id="stack-resources-title" data-stack-focus tabIndex={-1}>
          Skills and MCP servers
        </h2>
        <p>
          Catalog defaults are preselected per technology association. Every MCP server requires an explicit opt-in.
        </p>
      </div>

      <Show
        when={props.state.resources().length}
        fallback={
          <Card class="stack-empty-card">
            <strong>No resources selected</strong>
            <p>Continue to review removals for resources previously managed by this wizard.</p>
          </Card>
        }
      >
        <div class="stack-resource-groups">
          <For each={props.state.resources()}>
            {(group) => (
              <section class="stack-resource-group">
                <header>
                  <div>
                    <h3>{group.technology.name}</h3>
                    <p>Curated resources for this technology.</p>
                  </div>
                  <ConfigTag tone="neutral">{group.skills.length + group.mcps.length} resources</ConfigTag>
                </header>

                <Show when={group.skills.length}>
                  <div class="stack-resource-kind">
                    <h4>Skills</h4>
                    <div class="stack-resource-list">
                      <For each={group.skills}>{(item) => <ResourceCard state={props.state} item={item} />}</For>
                    </div>
                  </div>
                </Show>

                <Show when={group.mcps.length}>
                  <div class="stack-resource-kind">
                    <h4>MCP servers</h4>
                    <div class="stack-resource-list">
                      <For each={group.mcps}>{(item) => <ResourceCard state={props.state} item={item} />}</For>
                    </div>
                  </div>
                </Show>
              </section>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}
