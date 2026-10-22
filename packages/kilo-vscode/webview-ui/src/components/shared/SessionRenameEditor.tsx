import { Component, createSignal } from "solid-js"
import { InlineInput } from "@kilocode/kilo-ui/inline-input"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../../context/language"
import { parseSessionTitle, SESSION_TITLE_LIMIT } from "../../../../src/shared/session-title"

interface SessionRenameEditorProps {
  title: string
  autosize?: boolean
  fill?: boolean
  stop?: boolean
  onSave: (title: string) => void
  onCancel: () => void
}

export const SessionRenameEditor: Component<SessionRenameEditorProps> = (props) => {
  const language = useLanguage()
  const [value, setValue] = createSignal(props.title)

  const save = () => {
    const result = parseSessionTitle(value())
    if ("error" in result) {
      showToast({ variant: "error", title: language.t("toast.session.rename.invalid.title") })
      return
    }
    props.onSave(result.value)
  }

  return (
    <span data-slot="session-title-editor" data-fill={props.fill ? "" : undefined}>
      <InlineInput
        class="session-title-input"
        aria-label={language.t("common.rename")}
        value={value()}
        size={props.autosize ? Math.min(Math.max(value().length + 2, 14), 48) : undefined}
        maxLength={SESSION_TITLE_LIMIT}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (props.stop) e.stopPropagation()
          if (e.key === "Enter") {
            e.preventDefault()
            save()
          }
          if (e.key === "Escape") {
            e.preventDefault()
            props.onCancel()
          }
        }}
        onBlur={save}
        ref={(el) =>
          requestAnimationFrame(() => {
            el.focus()
            el.select()
          })
        }
      />
    </span>
  )
}
