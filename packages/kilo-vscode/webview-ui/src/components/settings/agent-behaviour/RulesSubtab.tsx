// The Rules subtab: the additional instruction files list plus the Claude Code compatibility switch. Instruction paths
// live in the config `instructions` array; the switch is the `kilo-code.v2.claudeCodeCompat` VS Code setting, which the
// host applies to the server spawn environment on the next start.
import { Component, For, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../../context/language"
import { useVSCode } from "../../../context/vscode"
import { useV2 } from "../../../v2/client"
import { useSettingsConfig } from "../../../v2/settings-config"
import SettingsRow from "../SettingsRow"
import Switch from "../Switch"

const RulesSubtab: Component = () => {
  const language = useLanguage()
  const vscode = useVSCode()
  const v2 = useV2()
  const config = useSettingsConfig()
  const [draft, setDraft] = createSignal("")

  const instructions = (): string[] => {
    const value = config.value(["instructions"])
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }

  const update = (next: string[]) => {
    if (next.length === 0) config.unset(["instructions"])
    else config.set(["instructions"], next)
  }

  const add = () => {
    const value = draft().trim()
    if (!value) return
    if (!instructions().includes(value)) update([...instructions(), value])
    setDraft("")
  }

  const remove = (index: number) => update(instructions().filter((_, item) => item !== index))

  // Instruction paths are relative to the workspace; the host opens an absolute path.
  const open = (file: string) => {
    const absolute = file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file)
      ? file
      : `${v2.directory.replace(/[\\/]+$/, "")}/${file.replace(/^\.?[\\/]/, "")}`
    vscode.postMessage({ type: "openFile", path: absolute } as never)
  }

  const claudeCompat = () => config.setting("claudeCodeCompat") === true

  return (
    <div>
      {/* Description */}
      <div
        style={{
          "font-size": "var(--kilo-font-size-12)",
          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
          "margin-bottom": "12px",
          "line-height": "1.5",
        }}
      >
        {language.t("settings.agentBehaviour.rules.description")}
      </div>

      <Card>
        <div
          style={{
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          <div style={{ "font-weight": "500" }}>{language.t("settings.agentBehaviour.instructionFiles")}</div>
          <div
            style={{
              "font-size": "var(--kilo-font-size-12)",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-top": "2px",
            }}
          >
            {language.t("settings.agentBehaviour.instructionFiles.description")}
          </div>
        </div>

        {/* Add new instruction path */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": instructions().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={draft()}
              placeholder="e.g. ./INSTRUCTIONS.md"
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

        {/* Instructions list */}
        <For each={instructions()}>
          {(path, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < instructions().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "var(--kilo-font-size-12)",
                }}
              >
                {path}
              </span>
              <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                <IconButton size="small" variant="ghost" icon="pencil-line" label={path} onClick={() => open(path)} />
                <IconButton size="small" variant="ghost" icon="close" onClick={() => remove(index())} />
              </div>
            </div>
          )}
        </For>
      </Card>

      {/* Claude Code compatibility */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.agentBehaviour.claudeCompat.heading")}
      </h4>
      <Card>
        <SettingsRow
          title={language.t("settings.agentBehaviour.claudeCompat.title")}
          description={language.t("settings.agentBehaviour.claudeCompat.description")}
          last
        >
          <Switch
            checked={claudeCompat()}
            onChange={(checked: boolean) => config.setSetting("claudeCodeCompat", checked)}
            hideLabel
          >
            {language.t("settings.agentBehaviour.claudeCompat.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default RulesSubtab
