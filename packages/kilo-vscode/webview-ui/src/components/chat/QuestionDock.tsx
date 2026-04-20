/**
 * QuestionDock component
 * Displays question requests from the AI assistant inline above the prompt input.
 * Uses kilo-ui's DockPrompt component for proper surface styling.
 */

import { For, Show, createMemo, createEffect } from "solid-js"
import type { Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { QuestionRequest } from "../../types/messages"
import { resolveOptimisticQuestionAgent, resolveSelectedQuestionMode, toggleAnswer } from "./question-dock-utils"

export const QuestionDock: Component<{ request: QuestionRequest }> = (props) => {
  const session = useSession()
  const language = useLanguage()

  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)

  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as string[][],
    custom: [] as string[],
    kinds: [] as Record<string, "option" | "custom">[],
    editing: false,
    sending: false,
    collapsed: false,
  })

  let root!: HTMLDivElement
  let prevAgent: string | undefined

  // Reset sending state and roll back the optimistic agent change on error
  createEffect(() => {
    if (session.questionErrors().has(props.request.id)) {
      setStore("sending", false)
      if (prevAgent !== undefined) {
        session.selectAgent(prevAgent)
        prevAgent = undefined
      }
    }
  })

  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    return store.answers[store.tab]?.includes(value) ?? false
  })

  const total = createMemo(() => questions().length)
  const last = createMemo(() => store.tab >= total() - 1)

  const summary = createMemo(() => {
    const n = Math.min(store.tab + 1, total())
    return language.t("question.summary", { n, total: total() })
  })

  const focusPrompt = () => requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))

  const reply = (answers: string[][]) => {
    if (store.sending) return
    setStore("sending", true)
    session.replyToQuestion(props.request.id, answers)
    focusPrompt()
    // prevAgent is intentionally left set until either questionError (rollback)
    // or the question is dismissed (success — the question unmounts, so no cleanup needed)
  }

  const reject = () => {
    if (store.sending) return
    setStore("sending", true)
    session.rejectQuestion(props.request.id)
    focusPrompt()
  }

  const submit = () => {
    reply(questions().map((_, i) => [...(store.answers[i] ?? [])]))
  }

  const back = () => {
    if (store.sending || store.tab <= 0) return
    setStore("tab", store.tab - 1)
    setStore("editing", false)
  }

  const syncAgent = (answers: string[][], kinds: Record<string, "option" | "custom">[] = store.kinds) => {
    const mode = resolveSelectedQuestionMode(questions(), answers, kinds)
    const next = resolveOptimisticQuestionAgent(prevAgent, session.selectedAgent(), mode)

    prevAgent = next.base
    if (!next.agent) return
    if (next.agent === session.selectedAgent()) return
    session.selectAgent(next.agent)
  }

  const pick = (answer: string, custom = false) => {
    const answers = [...store.answers]
    answers[store.tab] = [answer]
    setStore("answers", answers)

    const kinds = [...store.kinds]
    kinds[store.tab] = { [answer]: custom ? "custom" : "option" }
    setStore("kinds", kinds)

    if (custom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }

    syncAgent(answers, kinds)

    if (!single() && !multi()) {
      setStore("tab", store.tab + 1)
    }
  }

  const toggle = (answer: string) => {
    const next = toggleAnswer(store.answers[store.tab] ?? [], answer)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
    const kinds = [...store.kinds]
    const current = { ...(kinds[store.tab] ?? {}) }
    if (next.includes(answer)) current[answer] = "option"
    else delete current[answer]
    kinds[store.tab] = current
    setStore("kinds", kinds)
    syncAgent(answers, kinds)
  }

  const selectTab = (index: number) => {
    setStore("tab", index)
    setStore("editing", false)
  }

  const selectOption = (optIndex: number) => {
    if (store.sending) return

    if (optIndex === options().length) {
      setStore("editing", true)
      return
    }

    const opt = options()[optIndex]
    if (!opt) return
    if (multi()) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    if ((e.target as HTMLElement).tagName === "INPUT") return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const items = Array.from(
      el.querySelectorAll<HTMLButtonElement>("button[data-slot='question-option']:not(:disabled)"),
    )
    if (!items.length) return
    const idx = items.findIndex((b) => b === document.activeElement)
    const next =
      e.key === "ArrowDown"
        ? idx === -1
          ? 0
          : (idx + 1) % items.length
        : idx === -1
          ? items.length - 1
          : (idx - 1 + items.length) % items.length
    items[next]?.focus()
  }

  const handleCustomSubmit = (e: Event) => {
    e.preventDefault()
    if (store.sending) return

    const value = input().trim()
    if (!value) {
      setStore("editing", false)
      return
    }

    if (multi()) {
      const existing = store.answers[store.tab] ?? []
      const next = [...existing]
      if (!next.includes(value)) next.push(value)

      const answers = [...store.answers]
      answers[store.tab] = next
      setStore("answers", answers)
      const kinds = [...store.kinds]
      const current = { ...(kinds[store.tab] ?? {}) }
      current[value] = "custom"
      kinds[store.tab] = current
      setStore("kinds", kinds)
      syncAgent(answers, kinds)
      setStore("editing", false)
      return
    }

    pick(value, true)
    setStore("editing", false)
    if (single()) submit()
  }

  const toggleCollapse = () => {
    const collapsing = !store.collapsed
    setStore("collapsed", collapsing)
    // When collapsing inline, the content shrinks and can leave an empty gap
    // below the viewport. Scroll the dock into view so the gap is eliminated.
    if (collapsing) {
      requestAnimationFrame(() => root?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
    }
  }

  const onRoot = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      if (store.editing) {
        setStore("editing", false)
        return
      }
      reject()
      return
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      if (store.sending) return
      if (!confirm() && (store.answers[store.tab]?.length ?? 0) === 0) return
      submit()
      return
    }
  }

  // Keep keyboard navigation when the webview already has focus, but do not
  // steal focus from the editor, terminal, or other VS Code surfaces.
  createEffect(() => {
    void store.tab
    if (store.collapsed || store.editing || confirm()) return
    requestAnimationFrame(() => {
      if (!document.hasFocus()) return
      const btn = root?.querySelector<HTMLButtonElement>("button[data-slot='question-option']:not(:disabled)")
      btn?.focus()
    })
  })

  return (
    <div
      ref={root}
      data-component="question-dock"
      data-collapsed={store.collapsed ? "true" : "false"}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onKeyDown={onRoot}
    >
      {/* Single unified header row — always visible */}
      <div data-slot="question-dock-header" onClick={toggleCollapse}>
        <div data-slot="question-dock-header-content">
          <div data-slot="question-header-title">{summary()}</div>
          <Show when={store.collapsed}>
            <div data-slot="question-collapsed-preview">{question()?.question}</div>
          </Show>
        </div>
        <div data-slot="question-header-actions" onClick={(e: MouseEvent) => e.stopPropagation()}>
          <Show when={!store.collapsed && !single()}>
            <div data-slot="question-progress">
              <button
                type="button"
                data-slot="question-progress-nav"
                disabled={store.sending || store.tab <= 0}
                onClick={back}
              >
                <Icon name="chevron-left" size="small" />
              </button>
              <button
                type="button"
                data-slot="question-progress-nav"
                disabled={
                  store.sending ||
                  store.tab >= questions().length ||
                  (!confirm() && (store.answers[store.tab]?.length ?? 0) === 0)
                }
                onClick={() => selectTab(store.tab + 1)}
              >
                <Icon name="chevron-right" size="small" />
              </button>
            </div>
          </Show>
          <button
            type="button"
            data-slot="question-collapse-toggle"
            onClick={toggleCollapse}
            aria-label={store.collapsed ? "Expand" : "Collapse"}
          >
            <Icon name="chevron-down" size="small" />
          </button>
        </div>
      </div>

      {/* Animated body — hidden when collapsed */}
      <div data-slot="question-dock-body" inert={store.collapsed || undefined}>
        <div data-slot="question-dock-body-inner">
          <Show when={!confirm()}>
            <div data-slot="question-text">{question()?.question}</div>
            <Show when={multi()} fallback={<div data-slot="question-hint">{language.t("ui.question.singleHint")}</div>}>
              <div data-slot="question-hint">{language.t("ui.question.multiHint")}</div>
            </Show>
            <div data-slot="question-options" onKeyDown={onKey}>
              <For each={options()}>
                {(opt, i) => {
                  const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
                  return (
                    <button
                      data-slot="question-option"
                      data-picked={picked()}
                      disabled={store.sending}
                      onClick={() => selectOption(i())}
                    >
                      <span data-slot="question-option-check" aria-hidden="true">
                        <span
                          data-slot="question-option-box"
                          data-type={multi() ? "checkbox" : "radio"}
                          data-picked={picked()}
                        >
                          <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                            <Icon name="check-small" size="small" />
                          </Show>
                        </span>
                      </span>
                      <span data-slot="question-option-main">
                        <span data-slot="option-label">{opt.label}</span>
                        <Show when={opt.description}>
                          <span data-slot="option-description">{opt.description}</span>
                        </Show>
                      </span>
                    </button>
                  )
                }}
              </For>
              <Show when={question()?.custom !== false}>
                <button
                  data-slot="question-option"
                  data-custom="true"
                  data-picked={customPicked()}
                  disabled={store.sending}
                  onClick={() => selectOption(options().length)}
                >
                  <span data-slot="question-option-check" aria-hidden="true">
                    <span
                      data-slot="question-option-box"
                      data-type={multi() ? "checkbox" : "radio"}
                      data-picked={customPicked()}
                    >
                      <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                        <Icon name="check-small" size="small" />
                      </Show>
                    </span>
                  </span>
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">{language.t("ui.messagePart.option.typeOwnAnswer")}</span>
                    <Show when={!store.editing}>
                      <span data-slot="option-description" data-placeholder={!input()}>
                        {input() || language.t("ui.question.custom.placeholder")}
                      </span>
                    </Show>
                  </span>
                </button>
                <Show when={store.editing}>
                  <form data-slot="custom-input-form" onSubmit={handleCustomSubmit}>
                    <input
                      ref={(el) => {
                        setTimeout(() => {
                          if (!document.hasFocus()) return
                          el.focus()
                        }, 0)
                      }}
                      type="text"
                      data-slot="custom-input"
                      placeholder={language.t("ui.question.custom.placeholder")}
                      value={input()}
                      disabled={store.sending}
                      onInput={(e) => {
                        const inputs = [...store.custom]
                        inputs[store.tab] = e.currentTarget.value
                        setStore("custom", inputs)
                      }}
                    />
                    <Button type="submit" variant="primary" size="small" disabled={store.sending}>
                      {multi() ? language.t("ui.common.add") : language.t("ui.common.submit")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      disabled={store.sending}
                      onClick={() => setStore("editing", false)}
                    >
                      {language.t("ui.common.cancel")}
                    </Button>
                  </form>
                </Show>
              </Show>
            </div>
          </Show>

          <Show when={confirm()}>
            <div data-slot="question-review">
              <div data-slot="review-title">{language.t("ui.messagePart.review.title")}</div>
              <For each={questions()}>
                {(q, index) => {
                  const value = () => store.answers[index()]?.join(", ") ?? ""
                  const answered = () => Boolean(value())
                  return (
                    <div data-slot="review-item">
                      <span data-slot="review-label">{q.question}</span>
                      <span data-slot="review-value" data-answered={answered()}>
                        {answered() ? value() : language.t("ui.question.review.notAnswered")}
                      </span>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>

          {/* Footer row — inside the same box */}
          <div data-slot="question-dock-footer">
            <Button variant="ghost" size="small" onClick={reject} disabled={store.sending}>
              {language.t("ui.common.dismiss")}
            </Button>
            <div data-slot="question-footer-actions">
              <Show when={store.tab > 0}>
                <Button variant="secondary" size="small" onClick={back} disabled={store.sending}>
                  {language.t("ui.common.back")}
                </Button>
              </Show>
              <Show
                when={confirm()}
                fallback={
                  <Button
                    variant={last() && single() ? "primary" : "secondary"}
                    size="small"
                    onClick={last() && single() ? submit : () => selectTab(store.tab + 1)}
                    disabled={store.sending || (!confirm() && (store.answers[store.tab]?.length ?? 0) === 0)}
                  >
                    {last() && single()
                      ? language.t("ui.common.submit")
                      : last()
                        ? language.t("common.review")
                        : language.t("ui.common.next")}
                  </Button>
                }
              >
                <Button variant="primary" size="small" onClick={submit} disabled={store.sending}>
                  {language.t("ui.common.submit")}
                </Button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
