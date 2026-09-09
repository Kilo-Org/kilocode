import { type Accessor, type Component, Show, createMemo, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { ANNOTATION_COMMENT_LIMIT, type Annotation } from "../../utils/annotations"
import { annotationFocusOutside, type AnnotationEditorState } from "../../utils/annotation-state"
import { useLanguage } from "../../context/language"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"

interface AnnotationPopoverProps {
  annotation: Annotation
  rect: DOMRect
  comment: string
  disabled?: boolean
  onCommentChange: (annotationID: string, comment: string) => void
  onSave: (restoreFocus: boolean) => boolean
  onCancel: (restoreFocus: boolean) => void
  onDelete?: () => void
}

export const AnnotationPopover: Component<AnnotationPopoverProps> = (props) => {
  const language = useLanguage()
  let root: HTMLDivElement | undefined
  let content: Element | undefined
  let textarea: HTMLTextAreaElement | undefined
  let frame = 0

  const focusTextarea = () => {
    if (!textarea?.isConnected) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }

  const save = (restoreFocus: boolean) => {
    if (props.disabled) return
    if (!props.onSave(restoreFocus)) queueMicrotask(focusTextarea)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.shiftKey || !isEnterKeyCommitNotIme(event)) return
    event.preventDefault()
    save(true)
  }

  onMount(() => {
    content = root?.closest(".annotation-popover") ?? root
    const outside = (event: PointerEvent) => {
      if (props.disabled) return
      const target = event.target as Node | null
      if (!annotationFocusOutside(content, target)) return
      if (props.comment.trim()) save(false)
      else props.onCancel(false)
    }
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node | null
      if (!annotationFocusOutside(content, target)) return
      save(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!props.disabled) props.onCancel(true)
    }

    window.addEventListener("pointerdown", outside, true)
    window.addEventListener("focusin", focusOutside, true)
    window.addEventListener("keydown", escape, true)
    queueMicrotask(focusTextarea)
    frame = requestAnimationFrame(focusTextarea)

    onCleanup(() => {
      window.removeEventListener("pointerdown", outside, true)
      window.removeEventListener("focusin", focusOutside, true)
      window.removeEventListener("keydown", escape, true)
      if (frame) cancelAnimationFrame(frame)
    })
  })

  return (
    <Popover
      open={true}
      class="annotation-popover"
      contentLabel={language.t("annotations.annotate")}
      placement="top"
      gutter={6}
      overflowPadding={8}
      slide={true}
      getAnchorRect={() => props.rect}
      triggerAs="span"
      triggerProps={{ class: "annotation-popover-anchor", tabIndex: -1, "aria-hidden": "true" }}
    >
      <div ref={root} data-component="annotation-popover" class="annotation-popover-body" aria-busy={props.disabled}>
        <div
          class="annotation-popover-selection"
          title={props.annotation.selectedText}
          role="note"
          aria-label={language.t("annotations.selectedText")}
        >
          {props.annotation.selectedText}
        </div>
        <TextField
          ref={(element: HTMLInputElement | HTMLTextAreaElement) => (textarea = element as HTMLTextAreaElement)}
          class="annotation-popover-textarea"
          label={language.t("annotations.commentLabel")}
          hideLabel={true}
          multiline={true}
          rows={4}
          maxLength={ANNOTATION_COMMENT_LIMIT}
          value={props.comment}
          readOnly={props.disabled}
          onChange={(comment) => props.onCommentChange(props.annotation.id, comment)}
          onKeyDown={onKeyDown}
          placeholder={language.t("annotations.commentPlaceholder")}
        />
        <div class="annotation-popover-hint">{language.t("annotations.hint")}</div>
        <div class="annotation-popover-actions">
          <Show when={props.onDelete}>
            <Button variant="ghost" size="small" disabled={props.disabled} onClick={() => props.onDelete?.()}>
              {language.t("common.delete")}
            </Button>
          </Show>
          <span class="annotation-popover-spacer" />
          <Button variant="ghost" size="small" disabled={props.disabled} onClick={() => props.onCancel(true)}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={() => save(true)}
            disabled={props.disabled || !props.comment.trim()}
          >
            {language.t("common.save")}
          </Button>
        </div>
      </div>
    </Popover>
  )
}

interface AnnotationEditorHostProps {
  editor: Accessor<AnnotationEditorState | undefined>
  disabled?: boolean
  onCommentChange: (annotationID: string, comment: string) => void
  onSave: (restoreFocus: boolean) => boolean
  onCancel: (restoreFocus: boolean) => void
  onDelete: (annotationID: string) => void
}

export const AnnotationEditorHost: Component<AnnotationEditorHostProps> = (props) => (
  <Show when={props.editor()?.annotation.id} keyed>
    {(annotationID) => {
      const editor = createMemo<AnnotationEditorState>((previous) => {
        const current = props.editor()
        return current?.annotation.id === annotationID ? current : previous
      }, props.editor()!)
      return (
        <AnnotationPopover
          annotation={editor().annotation}
          rect={editor().rect}
          comment={editor().comment}
          disabled={props.disabled}
          onCommentChange={props.onCommentChange}
          onSave={props.onSave}
          onCancel={props.onCancel}
          onDelete={() => props.onDelete(annotationID)}
        />
      )
    }}
  </Show>
)
