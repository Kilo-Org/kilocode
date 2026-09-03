import { For, Show, createSignal, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { browserFeedbackData, type BrowserReference } from "../../../../src/shared/browser-feedback"
import { useLanguage } from "../../context/language"

interface BrowserReferencesProps {
  references: BrowserReference[]
  variant?: "draft" | "message"
  onRemove?: (id: string) => void
  onClear?: () => void
}

export const BrowserReferences: Component<BrowserReferencesProps> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(true)
  const [full, setFull] = createSignal<string[]>([])
  const data = () => browserFeedbackData(props.references)
  const rows = () => data()?.references ?? []
  const toggle = (id: string) =>
    setFull((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const page = (item: BrowserReference) => item.title || item.url
  const styles = (item: BrowserReference) =>
    [
      item.styles?.color ? `color=${item.styles.color}` : "",
      item.styles?.backgroundColor ? `background=${item.styles.backgroundColor}` : "",
    ]
      .filter(Boolean)
      .join(", ")
  const source = (item: BrowserReference) =>
    item.source
      ? [item.source.file, item.source.line, item.source.column].filter((value) => value !== undefined).join(":")
      : ""

  return (
    <div
      class="prompt-review-comments"
      classList={{ "prompt-review-comments--message": props.variant === "message" }}
      data-component="browser-references"
    >
      <div class="prompt-review-comments-header">
        <button
          type="button"
          class="prompt-review-comments-toggle"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
          <span class="prompt-review-comments-title">
            {language.t("agentManager.browser.title")} ({rows().length})
          </span>
        </button>
        <Show when={props.onClear}>
          <Button variant="ghost" size="small" onClick={() => props.onClear?.()}>
            {language.t("agentManager.review.clearAll")}
          </Button>
        </Show>
      </div>

      <Show when={open()}>
        <div class="prompt-review-list">
          <For each={rows()}>
            {(item) => (
              <div class="prompt-review-row" classList={{ "prompt-review-row--full": full().includes(item.id) }}>
                <div class="prompt-review-row-top">
                  <span class="prompt-review-row-icon">
                    <Icon name="globe" size="small" />
                  </span>
                  <button
                    type="button"
                    class="prompt-review-row-main"
                    aria-expanded={full().includes(item.id)}
                    onClick={() => toggle(item.id)}
                  >
                    <span class="prompt-review-row-head">
                      <span class="prompt-review-row-label">{item.selector}</span>
                    </span>
                    <Show when={!full().includes(item.id)}>
                      <span class="prompt-review-row-preview">
                        {item.text || item.source?.file || page(item) || ""}
                      </span>
                    </Show>
                  </button>
                  <Show when={props.onRemove}>
                    <button
                      type="button"
                      class="prompt-review-row-remove"
                      onClick={() => props.onRemove?.(item.id)}
                      aria-label={language.t("common.delete")}
                    >
                      ×
                    </button>
                  </Show>
                </div>

                <Show when={full().includes(item.id)}>
                  <div class="prompt-review-row-detail">
                    <Show when={item.url || item.title}>
                      {(value) => <div class="prompt-review-row-path">{value()}</div>}
                    </Show>
                    <Show when={item.hierarchy?.length}>
                      <pre class="prompt-review-row-snippet">{item.hierarchy?.join(" > ")}</pre>
                    </Show>
                    <Show when={item.text && (!item.html || item.html === item.text)}>
                      <pre class="prompt-review-row-snippet">{item.text}</pre>
                    </Show>
                    <Show when={item.html && item.html !== item.text}>
                      <pre class="prompt-review-row-snippet">{item.html}</pre>
                    </Show>
                    <Show when={styles(item)}>{(value) => <div class="prompt-review-row-text">{value()}</div>}</Show>
                    <Show when={source(item)}>{(value) => <code class="prompt-review-row-path">{value()}</code>}</Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
