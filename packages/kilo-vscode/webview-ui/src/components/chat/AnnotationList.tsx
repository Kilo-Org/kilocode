import { For, Show, createEffect, createSignal, createUniqueId, on } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import type { Annotation } from "../../utils/annotations"
import { useLanguage } from "../../context/language"

interface AnnotationListProps {
  annotations: readonly Annotation[]
  editingID?: string
  disabled?: boolean
  onEdit: (annotation: Annotation, rect: DOMRect, trigger: HTMLElement, fallback: HTMLElement) => void
  onDelete: (id: string) => void
  onClear: () => void
}

export function AnnotationList(props: AnnotationListProps) {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)
  const listID = `annotations-${createUniqueId()}`
  let toggle: HTMLButtonElement | undefined
  createEffect(
    on(
      () => props.editingID,
      (id) => {
        if (id !== undefined) setExpanded(false)
      },
    ),
  )

  return (
    <div class="prompt-annotations" data-component="prompt-annotations">
      <Button
        ref={(element: HTMLButtonElement) => (toggle = element)}
        class="prompt-annotations-toggle"
        variant="ghost"
        size="small"
        aria-expanded={expanded()}
        aria-controls={listID}
        title={language.t("annotations.toggleHint")}
        disabled={props.disabled}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{language.t("annotations.pendingCount", { count: props.annotations.length })}</span>
        <span class="prompt-annotations-chevron" data-open={expanded() ? "" : undefined} aria-hidden="true">
          <Icon name="chevron-down" size="small" />
        </span>
      </Button>
      <div id={listID} class="prompt-annotations-list" hidden={!expanded()}>
        <For each={props.annotations}>
          {(item) => (
            <div class="prompt-annotation-row" data-annotation-id={item.id}>
              <Show when={item.number !== undefined}>
                <span class="prompt-annotation-number">#{item.number}</span>
              </Show>
              <div class="prompt-annotation-main">
                <div class="prompt-annotation-selection" title={item.selectedText}>
                  {item.selectedText}
                </div>
                <div class="prompt-annotation-comment" title={item.comment}>
                  {item.comment}
                </div>
              </div>
              <div class="prompt-annotation-actions">
                <IconButton
                  icon="edit"
                  size="small"
                  variant="ghost"
                  aria-label={language.t("common.edit")}
                  disabled={props.disabled}
                  onClick={(event) => {
                    const trigger = event.currentTarget as HTMLElement
                    if (toggle) props.onEdit(item, trigger.getBoundingClientRect(), trigger, toggle)
                    setExpanded(false)
                  }}
                />
                <IconButton
                  icon="trash"
                  size="small"
                  variant="ghost"
                  aria-label={language.t("common.delete")}
                  disabled={props.disabled}
                  onClick={() => props.onDelete(item.id)}
                />
              </div>
            </div>
          )}
        </For>
        <Button
          class="prompt-annotations-clear"
          variant="ghost"
          size="small"
          disabled={props.disabled}
          onClick={props.onClear}
        >
          {language.t("annotations.clearAll")}
        </Button>
      </div>
    </div>
  )
}
