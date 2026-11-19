import { Component, For, createSignal } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../context/language"

/** Editable list of glob patterns, used by settings that store a string array in config. */
const PatternList: Component<{
  patterns: string[]
  description: string
  placeholder: string
  onChange: (patterns: string[]) => void
}> = (props) => {
  const language = useLanguage()
  const [draft, setDraft] = createSignal("")

  const add = () => {
    const value = draft().trim()
    if (!value) return
    if (!props.patterns.includes(value)) props.onChange([...props.patterns, value])
    setDraft("")
  }

  const remove = (index: number) => props.onChange(props.patterns.filter((_, item) => item !== index))

  return (
    <Card>
      <div
        style={{
          "font-size": "var(--kilo-font-size-12)",
          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
          "padding-bottom": "8px",
          "border-bottom": props.patterns.length > 0 || draft() ? "1px solid var(--border-weak-base)" : "none",
        }}
      >
        {props.description}
      </div>

      {/* Add new pattern */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          "align-items": "center",
          padding: "8px 0",
          "border-bottom": props.patterns.length > 0 ? "1px solid var(--border-weak-base)" : "none",
        }}
      >
        <div style={{ flex: 1 }}>
          <TextField
            value={draft()}
            placeholder={props.placeholder}
            onChange={(val) => setDraft(val)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter") add()
            }}
          />
        </div>
        <Button variant="secondary" onClick={add}>
          {language.t("common.add")}
        </Button>
      </div>

      {/* Pattern list */}
      <For each={props.patterns}>
        {(pattern, index) => (
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              padding: "6px 0",
              "border-bottom": index() < props.patterns.length - 1 ? "1px solid var(--border-weak-base)" : "none",
            }}
          >
            <span
              style={{
                "font-family": "var(--vscode-editor-font-family, monospace)",
                "font-size": "var(--kilo-font-size-12)",
              }}
            >
              {pattern}
            </span>
            <IconButton size="small" variant="ghost" icon="close" onClick={() => remove(index())} />
          </div>
        )}
      </For>
    </Card>
  )
}

export default PatternList
