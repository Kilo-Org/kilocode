import type { FormField, FormInfo, FormValue, PermissionRequest } from "@opencode/client"
import type { Data } from "@opencode/client/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { formAnswer } from "./form"
import type { Draft } from "./form"

export function Permission(props: { data: Data; request: PermissionRequest; error: (error: unknown) => void }) {
  const [busy, setBusy] = createSignal(false)
  function reply(decision: "once" | "always" | "reject") {
    setBusy(true)
    void props.data.session.permission
      .reply({ sessionID: props.request.sessionID, requestID: props.request.id, decision })
      .catch(props.error)
      .finally(() => setBusy(false))
  }
  return (
    <section class="dock" data-component="permission-dock" aria-label="Permission request">
      <h2>{props.request.action}</h2>
      <For each={props.request.resources}>{(resource) => <code class="resource">{resource}</code>}</For>
      <Show when={props.request.message}>
        <p class="prose">{props.request.message}</p>
      </Show>
      <div class="actions">
        <button disabled={busy()} onClick={() => reply("once")}>
          Allow once
        </button>
        <button class="secondary" disabled={busy()} onClick={() => reply("always")}>
          Allow always
        </button>
        <button class="secondary" disabled={busy()} onClick={() => reply("reject")}>
          Reject
        </button>
      </div>
    </section>
  )
}

export function Question(props: {
  data: Data
  form: FormInfo
  open: (url: string) => void
  error: (error: unknown) => void
}) {
  const [values, setValues] = createSignal<Draft>({})
  const [custom, setCustom] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal(false)
  const result = createMemo(() => formAnswer(props.form.fields, values(), custom()))
  const set = (key: string, value: FormValue) => setValues((values) => ({ ...values, [key]: value }))
  function submit() {
    if (busy() || result().errors.length) return
    setBusy(true)
    void props.data.session.form
      .reply({ sessionID: props.form.sessionID, formID: props.form.id, answer: result().answer })
      .catch(props.error)
      .finally(() => setBusy(false))
  }
  function dismiss() {
    setBusy(true)
    void props.data.session.form
      .cancel({ sessionID: props.form.sessionID, formID: props.form.id })
      .catch(props.error)
      .finally(() => setBusy(false))
  }
  return (
    <form
      class="dock"
      data-component="question-dock"
      aria-label="Question"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <h2>{props.form.title}</h2>
      <fieldset disabled={busy()} class="question-fields">
        <For each={result().visible}>
          {(field) => (
            <Field
              field={field}
              form={props.form.id}
              values={values()}
              custom={custom()[field.key] ?? ""}
              set={(value) => set(field.key, value)}
              setCustom={(value) => setCustom((custom) => ({ ...custom, [field.key]: value }))}
              open={props.open}
            />
          )}
        </For>
      </fieldset>
      <Show when={result().errors.length}>
        <p class="muted validation">{result().errors[0]}</p>
      </Show>
      <div class="actions">
        <button type="submit" disabled={busy() || result().errors.length > 0}>
          Submit
        </button>
        <button type="button" class="secondary" disabled={busy()} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </form>
  )
}

function Field(props: {
  field: FormField
  form: string
  values: Draft
  custom: string
  set: (value: FormValue) => void
  setCustom: (value: string) => void
  open: (url: string) => void
}) {
  const field = props.field
  const value = () => props.values[field.key] ?? (field.type !== "external" ? field.default : undefined)
  const text = () => String(value() ?? "")
  const selections = () => {
    const current = value()
    return Array.isArray(current) ? current : []
  }
  const control = () => {
    if (field.type === "external")
      return (
        <button type="button" class="secondary" onClick={() => props.open(field.url)}>
          Open link
        </button>
      )
    if (field.type === "boolean")
      return (
        <label class="option">
          <input
            data-slot="question-option"
            type="checkbox"
            checked={value() === true}
            onChange={(event) => props.set(event.currentTarget.checked)}
          />
          Yes
        </label>
      )
    if (field.type === "number" || field.type === "integer")
      return (
        <input
          data-slot="question-option"
          type="number"
          aria-label={field.title || field.key}
          value={text()}
          step={field.type === "integer" ? 1 : "any"}
          min={field.minimum}
          max={field.maximum}
          onInput={(event) => props.set(event.currentTarget.value)}
        />
      )
    if (field.type === "multiselect")
      return (
        <>
          <For each={field.options}>
            {(option) => (
              <label class="option">
                <input
                  data-slot="question-option"
                  type="checkbox"
                  checked={selections().includes(option.value)}
                  onChange={(event) => {
                    props.set(
                      event.currentTarget.checked
                        ? [...selections(), option.value]
                        : selections().filter((value) => value !== option.value),
                    )
                  }}
                />
                <span>
                  {option.label}
                  <Show when={option.description}>
                    <small class="muted">{option.description}</small>
                  </Show>
                </span>
              </label>
            )}
          </For>
          <Show when={field.custom}>
            <input
              data-slot="question-option"
              type="text"
              aria-label={`Custom answer for ${field.title || field.key}`}
              placeholder="Other answer"
              value={props.custom}
              onInput={(event) => props.setCustom(event.currentTarget.value)}
            />
          </Show>
        </>
      )
    if (field.options?.length)
      return (
        <>
          <For each={field.options}>
            {(option) => (
              <label class="option">
                <input
                  data-slot="question-option"
                  type="radio"
                  name={`${props.form}-${field.key}`}
                  checked={!props.custom && value() === option.value}
                  onChange={() => {
                    props.set(option.value)
                    props.setCustom("")
                  }}
                />
                <span>
                  {option.label}
                  <Show when={option.description}>
                    <small class="muted">{option.description}</small>
                  </Show>
                </span>
              </label>
            )}
          </For>
          <Show when={field.custom}>
            <input
              data-slot="question-option"
              type="text"
              aria-label={`Custom answer for ${field.title || field.key}`}
              placeholder="Other answer"
              value={props.custom || (field.options?.some((option) => option.value === value()) ? "" : text())}
              onInput={(event) => {
                props.set("")
                props.setCustom(event.currentTarget.value)
              }}
            />
          </Show>
        </>
      )
    return (
      <input
        data-slot="question-option"
        type="text"
        aria-label={field.title || field.key}
        value={text()}
        placeholder={field.placeholder}
        onInput={(event) => props.set(event.currentTarget.value)}
      />
    )
  }
  return (
    <fieldset class="question-field">
      <legend>
        {field.title || field.key}
        {field.type !== "external" && field.required ? " *" : ""}
      </legend>
      <Show when={field.description}>
        <p class="muted">{field.description}</p>
      </Show>
      {control()}
    </fieldset>
  )
}
