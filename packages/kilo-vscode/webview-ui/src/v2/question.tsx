import type { FormField, FormInfo, FormValue } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { useLanguage } from "../context/language"
import { isTextControl } from "../utils/focus"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import { useV2 } from "./client"
import { type Draft, formAnswer } from "./form"

export function QuestionDock(props: { form: FormInfo }) {
  const v2 = useV2()
  const language = useLanguage()
  const [values, setValues] = createSignal<Draft>({})
  const [custom, setCustom] = createSignal<Record<string, string>>({})
  const [input, setInput] = createSignal("")
  const [tab, setTab] = createSignal(0)
  const [editing, setEditing] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const [collapsed, setCollapsed] = createSignal(false)
  const refs = { root: undefined as HTMLDivElement | undefined }
  const result = createMemo(() => formAnswer(props.form.fields, values(), custom()))
  const fields = () => result().visible
  const field = () => fields()[tab()]
  const single = () => fields().length === 1 && fields()[0]?.type !== "multiselect"
  const confirm = () => !single() && tab() >= fields().length
  const last = () => tab() >= fields().length - 1
  const multi = () => field()?.type === "multiselect"
  const options = () => {
    const current = field()
    return current?.type === "string" || current?.type === "multiselect" ? (current.options ?? []) : []
  }
  const free = () => {
    const current = field()
    return (
      (current?.type === "multiselect" || (current?.type === "string" && !!current.options?.length)) &&
      current.custom === true
    )
  }
  const value = (current: FormField | undefined = field()) => {
    if (!current || current.type === "external") return undefined
    return values()[current.key] ?? current.default ?? (current.type === "boolean" ? false : undefined)
  }
  const text = (current: FormField | undefined = field()) => {
    if (!current) return props.form.title
    return props.form.metadata?.kind === "question"
      ? (current.description ?? current.title ?? props.form.title)
      : (current.title ?? current.description ?? props.form.title)
  }
  const picked = (option: string) => {
    const current = field()
    if (!current) return false
    const answer = result().answer[current.key]
    return Array.isArray(answer) ? answer.includes(option) : answer === option
  }
  const own = () => {
    const current = field()
    return current ? (custom()[current.key] ?? "") : ""
  }
  const answered = () => {
    const current = field()
    if (!current || current.type === "external") return true
    if (props.form.metadata?.kind !== "question" && !current.required) return true
    const answer = result().answer[current.key]
    return answer !== undefined && (!Array.isArray(answer) || answer.length > 0)
  }

  createEffect(
    on(
      () => props.form.id,
      () => {
        setValues({})
        setCustom({})
        setInput("")
        setTab(0)
        setEditing(false)
        setSending(false)
        setCollapsed(false)
      },
    ),
  )

  const select = (index: number) => {
    setTab(index)
    setEditing(false)
  }
  const back = () => {
    if (sending() || tab() <= 0) return
    select(tab() - 1)
  }
  const set = (answer: FormValue) => {
    const current = field()
    if (!current) return
    setValues((values) => ({ ...values, [current.key]: answer }))
  }
  const pick = (option: string) => {
    const current = field()
    if (!current || sending()) return
    if (current.type === "multiselect") {
      const answer = value()
      const selected = Array.isArray(answer) ? answer : []
      set(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])
      if (own() === option) setCustom((custom) => ({ ...custom, [current.key]: "" }))
      return
    }
    set(option)
    setCustom((custom) => ({ ...custom, [current.key]: "" }))
    setEditing(false)
    if (!single()) select(tab() + 1)
  }
  const selectCustom = () => {
    if (sending()) return
    setInput(own())
    if (!multi() && !own()) set("")
    setEditing(true)
  }
  const commit = (event: Event) => {
    event.preventDefault()
    const current = field()
    const answer = input().trim()
    if (!current || sending() || !answer) return
    setCustom((custom) => ({ ...custom, [current.key]: answer }))
    if (current.type === "multiselect") {
      const selected = value()
      set([...new Set([...(Array.isArray(selected) ? selected : []), answer])])
    }
    setEditing(false)
    if (single()) {
      submit()
      return
    }
    if (!multi()) select(tab() + 1)
  }
  const focus = () => requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
  const submit = () => {
    if (sending() || (!confirm() && !answered())) return
    if (result().errors.length) {
      v2.report(result().errors.join("\n"))
      return
    }
    setSending(true)
    void v2.data.session.form
      .reply({ sessionID: props.form.sessionID, formID: props.form.id, answer: result().answer })
      .then(focus)
      .catch(v2.report)
      .finally(() => setSending(false))
  }
  const reject = () => {
    if (sending()) return
    setSending(true)
    void v2.data.session.form
      .cancel({ sessionID: props.form.sessionID, formID: props.form.id })
      .then(focus)
      .catch(v2.report)
      .finally(() => setSending(false))
  }
  const toggleCollapse = () => {
    const next = !collapsed()
    setCollapsed(next)
    if (next) requestAnimationFrame(() => refs.root?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    if (isTextControl(document.activeElement)) return
    const buttons = Array.from(
      refs.root?.querySelectorAll<HTMLButtonElement>("button[data-slot='question-option']:not(:disabled)") ?? [],
    )
    if (!buttons.length) return
    event.preventDefault()
    const index = buttons.findIndex((button) => button === document.activeElement)
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % buttons.length
        : index === -1
          ? buttons.length - 1
          : (index - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  createEffect(() => {
    tab()
    if (collapsed() || editing() || confirm()) return
    requestAnimationFrame(() => {
      if (!document.hasFocus() || isTextControl(document.activeElement) || !refs.root?.isConnected) return
      const selector = "button[data-slot='question-option']:not(:disabled)"
      const button =
        refs.root.querySelector<HTMLButtonElement>(`${selector}[data-picked='true']`) ??
        refs.root.querySelector<HTMLButtonElement>(selector)
      button?.focus({ preventScroll: true })
    })
  })

  return (
    <div
      ref={(el) => (refs.root = el)}
      data-component="question-dock"
      data-collapsed={collapsed() ? "true" : "false"}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          if (editing()) {
            setEditing(false)
            return
          }
          reject()
          return
        }
        if (!isEnterKeyCommitNotIme(event) || (!event.metaKey && !event.ctrlKey)) return
        event.preventDefault()
        event.stopPropagation()
        submit()
      }}
    >
      <div data-slot="question-dock-header" onClick={toggleCollapse}>
        <div data-slot="question-dock-header-content">
          <div data-slot="question-header-title">
            {props.form.metadata?.kind === "question"
              ? language.t("question.summary", { n: Math.min(tab() + 1, fields().length), total: fields().length })
              : props.form.title}
          </div>
          <Show when={collapsed()}>
            <div data-slot="question-collapsed-preview" dir="auto">
              {text()}
            </div>
          </Show>
        </div>
        <div data-slot="question-header-actions" onClick={(event) => event.stopPropagation()}>
          <Show when={!collapsed() && !single()}>
            <div data-slot="question-progress">
              <button
                type="button"
                data-slot="question-progress-nav"
                aria-label={language.t("ui.common.back")}
                disabled={sending() || tab() <= 0}
                onClick={back}
              >
                <Icon name="chevron-left" size="small" />
              </button>
              <button
                type="button"
                data-slot="question-progress-nav"
                aria-label={language.t("ui.common.next")}
                disabled={sending() || confirm() || !answered()}
                onClick={() => select(tab() + 1)}
              >
                <Icon name="chevron-right" size="small" />
              </button>
            </div>
          </Show>
          <button
            type="button"
            data-slot="question-collapse-toggle"
            onClick={toggleCollapse}
            aria-label={language.t(collapsed() ? "dialog.model.expand" : "dialog.model.collapse")}
          >
            <Icon name="chevron-down" size="small" />
          </button>
        </div>
      </div>
      <div data-slot="question-dock-body" inert={collapsed() || undefined}>
        <div data-slot="question-dock-body-inner">
          <Show when={!confirm()}>
            <div data-slot="question-text" dir="auto">
              {text()}
            </div>
            <Show when={props.form.metadata?.kind !== "question" && field()?.description}>
              <div data-slot="question-hint" dir="auto">
                {field()?.description}
              </div>
            </Show>
            <Show when={options().length > 0}>
              <div data-slot="question-hint">
                {language.t(multi() ? "ui.question.multiHint" : "ui.question.singleHint")}
              </div>
            </Show>
            <div data-slot="question-options" onKeyDown={onKey}>
              <For each={options()}>
                {(option) => (
                  <button
                    type="button"
                    data-slot="question-option"
                    data-picked={picked(option.value)}
                    aria-pressed={picked(option.value)}
                    disabled={sending()}
                    onClick={() => pick(option.value)}
                  >
                    <span data-slot="question-option-check" aria-hidden="true">
                      <span
                        data-slot="question-option-box"
                        data-type={multi() ? "checkbox" : "radio"}
                        data-picked={picked(option.value)}
                      >
                        <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                          <Icon name="check-small" size="small" />
                        </Show>
                      </span>
                    </span>
                    <span data-slot="question-option-main">
                      <span data-slot="option-label" dir="auto">
                        {option.label}
                      </span>
                      <Show when={option.description}>
                        <span data-slot="option-description" dir="auto">
                          {option.description}
                        </span>
                      </Show>
                    </span>
                  </button>
                )}
              </For>
              <Show when={free()}>
                <button
                  type="button"
                  data-slot="question-option"
                  data-custom="true"
                  data-picked={editing() || !!own()}
                  disabled={sending()}
                  onClick={selectCustom}
                >
                  <span data-slot="question-option-check" aria-hidden="true">
                    <span
                      data-slot="question-option-box"
                      data-type={multi() ? "checkbox" : "radio"}
                      data-picked={editing() || !!own()}
                    >
                      <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                        <Icon name="check-small" size="small" />
                      </Show>
                    </span>
                  </span>
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">{language.t("ui.messagePart.option.typeOwnAnswer")}</span>
                    <Show when={!editing()}>
                      <span data-slot="option-description" data-placeholder={!own()}>
                        {own() || language.t("ui.question.custom.placeholder")}
                      </span>
                    </Show>
                  </span>
                </button>
                <Show when={editing()}>
                  <form data-slot="custom-input-form" onSubmit={commit}>
                    <input
                      ref={(el) => requestAnimationFrame(() => document.hasFocus() && el.focus())}
                      type="text"
                      data-slot="custom-input"
                      placeholder={language.t("ui.question.custom.placeholder")}
                      aria-label={language.t("ui.messagePart.option.typeOwnAnswer")}
                      value={input()}
                      disabled={sending()}
                      onInput={(event) => setInput(event.currentTarget.value)}
                    />
                    <Button type="submit" variant="primary" size="small" disabled={sending() || !input().trim()}>
                      {language.t(multi() ? "ui.common.add" : "ui.common.submit")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      disabled={sending()}
                      onClick={() => setEditing(false)}
                    >
                      {language.t("ui.common.cancel")}
                    </Button>
                  </form>
                </Show>
              </Show>
              <Show when={field()} keyed>
                {(current) => {
                  if (current.type === "external")
                    return (
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={sending()}
                        onClick={() => v2.open(current.url)}
                      >
                        {current.title ?? current.url}
                      </Button>
                    )
                  if (current.type === "boolean")
                    return (
                      <button
                        type="button"
                        data-slot="question-option"
                        data-picked={value(current) === true}
                        aria-pressed={value(current) === true}
                        disabled={sending()}
                        onClick={() => set(value(current) !== true)}
                      >
                        <span data-slot="question-option-check" aria-hidden="true">
                          <span
                            data-slot="question-option-box"
                            data-type="checkbox"
                            data-picked={value(current) === true}
                          >
                            <Icon name="check-small" size="small" />
                          </span>
                        </span>
                        <span data-slot="question-option-main">
                          <span data-slot="option-label" dir="auto">
                            {current.title ?? props.form.title}
                          </span>
                          <Show when={current.description}>
                            <span data-slot="option-description" dir="auto">
                              {current.description}
                            </span>
                          </Show>
                        </span>
                      </button>
                    )
                  if (current.type === "multiselect" || (current.type === "string" && current.options?.length))
                    return null
                  return (
                    <div data-slot="custom-input-form">
                      <input
                        data-slot="custom-input"
                        type={current.type === "string" ? (current.format === "email" ? "email" : "text") : "number"}
                        step={current.type === "integer" ? 1 : "any"}
                        min={
                          current.type === "string" || current.minimum === undefined
                            ? undefined
                            : Number(current.minimum)
                        }
                        max={
                          current.type === "string" || current.maximum === undefined
                            ? undefined
                            : Number(current.maximum)
                        }
                        minLength={current.type === "string" ? current.minLength : undefined}
                        maxLength={current.type === "string" ? current.maxLength : undefined}
                        placeholder={
                          current.type === "string"
                            ? (current.placeholder ?? language.t("ui.question.custom.placeholder"))
                            : undefined
                        }
                        aria-label={current.title ?? props.form.title}
                        value={String(value(current) ?? "")}
                        disabled={sending()}
                        onInput={(event) => set(event.currentTarget.value)}
                      />
                    </div>
                  )
                }}
              </Show>
            </div>
          </Show>
          <Show when={confirm()}>
            <div data-slot="question-review">
              <div data-slot="review-title">{language.t("ui.messagePart.review.title")}</div>
              <For each={fields()}>
                {(current) => {
                  const answer = () => result().answer[current.key]
                  const display = () => {
                    const selected = answer()
                    if (selected === undefined) return ""
                    const options =
                      current.type === "string" || current.type === "multiselect" ? current.options : undefined
                    const label = (value: string) => options?.find((option) => option.value === value)?.label ?? value
                    if (Array.isArray(selected)) return selected.map(label).join(", ")
                    return label(String(selected))
                  }
                  return (
                    <div data-slot="review-item">
                      <span data-slot="review-label" dir="auto">
                        {text(current)}
                      </span>
                      <span data-slot="review-value" data-answered={answer() !== undefined} dir="auto">
                        {current.type === "external"
                          ? current.url
                          : display() || language.t("ui.question.review.notAnswered")}
                      </span>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
          <div data-slot="question-dock-footer">
            <Button variant="ghost" size="small" onClick={reject} disabled={sending()}>
              {language.t("ui.common.dismiss")}
            </Button>
            <Show when={!editing()}>
              <div data-slot="question-footer-actions">
                <Show when={tab() > 0}>
                  <Button variant="secondary" size="small" onClick={back} disabled={sending()}>
                    {language.t("ui.common.back")}
                  </Button>
                </Show>
                <Show
                  when={confirm()}
                  fallback={
                    <Button
                      variant={last() && single() ? "primary" : "secondary"}
                      size="small"
                      onClick={last() && single() ? submit : () => select(tab() + 1)}
                      disabled={sending() || !answered()}
                    >
                      {language.t(
                        last() && single() ? "ui.common.submit" : last() ? "common.review" : "ui.common.next",
                      )}
                    </Button>
                  }
                >
                  <Button variant="primary" size="small" onClick={submit} disabled={sending()}>
                    {language.t("ui.common.submit")}
                  </Button>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
