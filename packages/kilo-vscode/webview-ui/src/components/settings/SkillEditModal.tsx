import { createSignal, onCleanup } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { SkillInfo } from "../../types/messages"

interface Props {
  skill: SkillInfo
  onClose: () => void
  onSave: (updatedSkill: { name: string; content: string }) => void
}

const getInitialSkillContent = (skill: SkillInfo): string => {
  const skillWithContent = skill as SkillInfo & { content?: unknown }
  return typeof skillWithContent.content === "string" ? skillWithContent.content : ""
}

export const SkillEditModal = (props: Props) => {
  const language = useLanguage()
  const vscode = useVSCode()

  const [name, setName] = createSignal(props.skill.name)
  const [content, setContent] = createSignal(getInitialSkillContent(props.skill))
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Listen for save result
  const unsubscribe = vscode.onMessage((msg) => {
    if (msg.type === "skillEditResult") {
      setSaving(false)
      if (msg.success) {
        props.onSave({ name: name(), content: content() })
        props.onClose()
      } else {
        setError(msg.error || "Failed to save skill")
      }
    }
  })

  onCleanup(unsubscribe)

  const handleSave = () => {
    if (!name().trim()) {
      setError("Skill name cannot be empty")
      return
    }

    setSaving(true)
    setError(null)

    vscode.postMessage({
      type: "editSkill",
      originalName: props.skill.name,
      name: name(),
      content: content(),
    })
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <div
        style={{
          "min-width": "600px",
          "max-width": "800px",
          "max-height": "80vh",
          display: "flex",
          "flex-direction": "column",
          gap: "16px",
        }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>
          {language.t("settings.agentBehaviour.editSkill") || "Edit Skill"}
        </h3>

        {/* Skill Name */}
        <div>
          <label style={{ display: "block", "margin-bottom": "4px", "font-size": "12px", "font-weight": "500" }}>
            {language.t("common.name") || "Name"}
          </label>
          <TextField
            value={name()}
            onChange={(val) => setName(val)}
            placeholder="Skill name"
            disabled={saving()}
          />
        </div>

        {/* Skill Content */}
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", "margin-bottom": "4px", "font-size": "12px", "font-weight": "500" }}>
            {language.t("common.content") || "Content"}
          </label>
          <textarea
            value={content()}
            onInput={(e) => setContent(e.currentTarget.value)}
            placeholder="Skill content (SKILL.md format)"
            disabled={saving()}
            style={{
              width: "100%",
              height: "300px",
              "font-family": "var(--vscode-editor-font-family, monospace)",
              "font-size": "12px",
              padding: "8px",
              border: "1px solid var(--vscode-input-border, var(--border-weak-base))",
              "background-color": "var(--vscode-input-background, var(--surface-primary))",
              color: "var(--vscode-input-foreground, var(--text-base))",
              "border-radius": "4px",
              "box-sizing": "border-box",
            }}
          />
        </div>

        {/* Error Message */}
        {error() && (
          <div
            style={{
              "background-color": "var(--vscode-inputValidation-errorBackground)",
              color: "var(--vscode-inputValidation-errorForeground)",
              padding: "8px",
              "border-radius": "4px",
              "font-size": "12px",
            }}
          >
            {error()}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
          <Button
            variant="secondary"
            onClick={() => props.onClose()}
            disabled={saving()}
          >
            {language.t("common.cancel") || "Cancel"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving() || !name().trim()}
          >
            {saving() ? (language.t("common.saving") || "Saving...") : (language.t("common.save") || "Save")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
