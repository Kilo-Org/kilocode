import { Component, Show, createMemo } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"

import { useLanguage } from "../../context/language"
import type { PermissionLevel, PermissionRuleset } from "./permission-utils"

type LevelValue = PermissionLevel | "inherit"

interface LevelOption {
  value: LevelValue
  labelKey: string
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: "allow", labelKey: "settings.autoApprove.level.allow" },
  { value: "ask", labelKey: "settings.autoApprove.level.ask" },
  { value: "deny", labelKey: "settings.autoApprove.level.deny" },
]

const INHERIT_OPTION: LevelOption = { value: "inherit", labelKey: "common.default" }

export const SimpleToolRow: Component<{
  title: string
  descriptionKey: string
  level: PermissionLevel
  inherited?: boolean
  showDefaultLevel?: boolean
  exceptions?: PermissionRuleset
  onChange: (level: PermissionLevel) => void
  onInherit?: () => void
}> = (props) => {
  const language = useLanguage()
  const exceptions = () => props.exceptions ?? []
  return (
    <div
      style={{
        display: "flex",
        gap: "24px",
        "align-items": "flex-start",
        "justify-content": "space-between",
        padding: "12px 0",
        "border-bottom": "1px solid var(--border-weak-base)",
      }}
    >
      <div style={{ flex: 1, "min-width": 0 }}>
        <div style={{ "font-size": "var(--kilo-font-size-13)", color: "var(--text-base, var(--vscode-foreground))" }}>
          {props.title}
        </div>
        <div
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "margin-top": "6px",
          }}
        >
          {language.t(props.descriptionKey)}
        </div>
        <Show when={exceptions().length > 0}>
          <div
            style={{
              "font-size": "var(--kilo-font-size-12)",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-top": "6px",
              "overflow-wrap": "anywhere",
            }}
          >
            {language.t("settings.autoApprove.exceptions")} ({exceptions().length}):{" "}
            {exceptions()
              .map((item) => `${language.t(`settings.autoApprove.level.${item.effect}`)} ${item.resource}`)
              .join(", ")}
          </div>
        </Show>
      </div>
      <ActionSelect
        level={props.level}
        inherited={props.inherited}
        showDefaultLevel={props.showDefaultLevel}
        onChange={props.onChange}
        onInherit={props.onInherit}
      />
    </div>
  )
}

export const ActionSelect: Component<{
  level: PermissionLevel
  inherited?: boolean
  showDefaultLevel?: boolean
  onChange: (level: PermissionLevel) => void
  onInherit?: () => void
}> = (props) => {
  const language = useLanguage()
  const opts = createMemo(() => (props.onInherit ? [INHERIT_OPTION, ...LEVEL_OPTIONS] : LEVEL_OPTIONS))
  const label = (option: LevelOption) => {
    if (option.value !== "inherit" || !props.showDefaultLevel) return language.t(option.labelKey)
    const level = LEVEL_OPTIONS.find((item) => item.value === props.level)!
    return `${language.t(option.labelKey)} (${language.t(level.labelKey)})`
  }
  return (
    <Select
      options={opts()}
      current={props.inherited ? INHERIT_OPTION : LEVEL_OPTIONS.find((option) => option.value === props.level)}
      value={(option) => option.value}
      label={label}
      onSelect={(option) => {
        if (!option) return
        if (option.value === "inherit") {
          props.onInherit?.()
          return
        }
        props.onChange(option.value)
      }}
      variant="secondary"
      size="small"
      triggerVariant="settings"
    />
  )
}
